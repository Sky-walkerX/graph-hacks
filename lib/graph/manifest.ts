import prisma from "@/lib/prisma";
import type { PinnedPage } from "@/lib/handoff/card";
import { GraphUnavailable, read } from "./client";
import {
  attemptsFor, contextFor, diff, findReceipt, impactOf, linkDependency, outcomes, receiptForTask, recordOutcome, recordReceipt,
  type Attempt, type Change, type Delivered, type Item, type Receipt,
} from "./context";
import { projectTask, syncedGraph } from "./project";
import { keystones, whoKnows } from "./brain";
import { receiptView } from "./view";

// The manifest: what a baton's next agent is handed, worked out in the graph
// and kept as a receipt, then checked against the notebook as it moves on.
// The MCP tools and the app call these; lib/graph/context.ts has the walks.

export { GraphUnavailable };

/** The current text of the pages a context delivers, in its order. */
async function pagesOf(userId: string, items: Item[]): Promise<PinnedPage[]> {
  if (items.length === 0) return [];
  const rows = await prisma.milestone.findMany({
    where: { id: { in: items.map((i) => i.id) }, subject: { userId } },
    select: { id: true, page: true, title: true, notes: true },
  });
  return items.flatMap((i) => rows.filter((r) => r.id === i.id));
}

export type Delivery = { receipt: Receipt; pages: PinnedPage[]; attempts: Attempt[] };

/** Works out a baton's context for `agent`, records the receipt, and returns both. */
export async function deliver(userId: string, agent: string, handoffId: string, refreshes?: string): Promise<Delivery> {
  const graph = await syncedGraph(userId);
  const context = await contextFor(graph, handoffId);
  const receipt = await recordReceipt(graph, handoffId, agent, context, refreshes);
  return { receipt, pages: await pagesOf(userId, context.items), attempts: await attemptsFor(graph, handoffId) };
}

export type Check = {
  receipt: { id: string; at: number; handoff: string; refreshed: boolean };
  changes: Change[];
  /** The new receipt and the changed pages' text, when asked to refresh and something changed. */
  refreshed: Delivery | null;
  /** What was tried and ruled out on this work, with whether its premise has moved on. */
  attempts: Attempt[];
};

/**
 * Compares what `agent` was handed (its newest receipt, or the one named)
 * with the baton's context now. With `refresh`, and something changed, it
 * hands over the new context in a receipt that replaces the old one.
 */
export async function check(userId: string, agent: string, receiptId: string | undefined, refresh: boolean): Promise<Check | null> {
  const graph = await syncedGraph(userId);
  const found = await findReceipt(graph, agent, receiptId);
  if (!found) return null;
  const now = await contextFor(graph, found.handoff);
  const changes = diff(found.delivered, now.items);
  const attempts = await attemptsFor(graph, found.handoff);
  let refreshed: Delivery | null = null;
  if (refresh && changes.length > 0) {
    const receipt = await recordReceipt(graph, found.handoff, agent, now, found.id);
    const changed = now.items.filter((i) => changes.some((c) => "now" in c && c.now.id === i.id));
    refreshed = { receipt, pages: await pagesOf(userId, changed), attempts };
  }
  return { receipt: { id: found.id, at: found.at, handoff: found.handoff, refreshed: found.refreshed }, changes, refreshed, attempts };
}

/** The changes since `agent` picked up the baton for a task, if it did. Null when it holds no receipt for it. */
export async function changesForTask(userId: string, agent: string, taskId: string): Promise<Change[] | null> {
  const graph = await syncedGraph(userId);
  const id = await receiptForTask(graph, agent, taskId);
  if (!id) return null;
  const found = (await findReceipt(graph, agent, id))!;
  return diff(found.delivered, (await contextFor(graph, found.handoff)).items);
}

/** Records that `agent` finished a task against its current receipt for it. */
export async function finished(userId: string, agent: string, taskId: string) {
  return recordOutcome(await syncedGraph(userId), agent, taskId);
}

/** How a task was finished, or every finished task when none is named, with what changed since. */
export async function traceOutcomes(userId: string, taskId?: string) {
  return outcomes(await syncedGraph(userId), taskId);
}

export type Manifest = {
  receipt: { id: string; at: number; warnings: string[]; refreshes: number };
  agent: string;
  baton: { id: string; goal: string; status: string };
  delivered: Delivered[];
  changes: Change[];
};

/**
 * Each agent's current receipt (the newest per baton and agent that nothing
 * refreshed), with what changed since it was handed over: the app's view of
 * who is working from what.
 */
export async function listManifests(userId: string, limit = 8): Promise<Manifest[]> {
  const graph = await syncedGraph(userId);
  const rows = await read<{ id: string; at: number; warnings: string[]; agent: string; handoff: string; goal: string; status: string; refreshes: number }>(
    graph,
    `MATCH (a:Agent)-[:RECEIVED]->(r:Receipt)-[:FOR]->(h:Handoff)
     WHERE NOT ()-[:REFRESHES]->(r)
     RETURN r.id AS id, r.at AS at, r.warnings AS warnings, a.name AS agent, h.id AS handoff, h.goal AS goal, h.status AS status,
            size([(r)-[:REFRESHES*1..20]->(:Receipt) | 1]) AS refreshes
     ORDER BY at DESC LIMIT $limit`,
    { limit },
  );
  return Promise.all(
    rows.map(async (r) => {
      const found = (await findReceipt(graph, r.agent, r.id))!;
      const now = await contextFor(graph, r.handoff);
      return {
        receipt: { id: r.id, at: r.at, warnings: r.warnings ?? [], refreshes: r.refreshes },
        agent: r.agent,
        baton: { id: r.handoff, goal: r.goal, status: r.status },
        delivered: found.delivered,
        changes: diff(found.delivered, now.items),
      };
    }),
  );
}

/** What leans on a note: see impactOf. */
export async function impact(userId: string, noteId: string) {
  return impactOf(await syncedGraph(userId), noteId);
}

/** Records that a task or note depends on a note. */
export async function dependOn(userId: string, agent: string, from: { taskId?: string; noteId?: string }, on: string, reason: string | null) {
  const graph = await syncedGraph(userId);
  if (from.taskId && !(await projectTask(graph, userId, from.taskId))) return "missing-from" as const;
  return linkDependency(graph, (from.taskId ?? from.noteId)!, on, agent, reason);
}

/** What's known about a topic or a file, and by which agents: see whoKnows. */
export async function knows(userId: string, find: { topic?: string; file?: string }) {
  return whoKnows(await syncedGraph(userId), find);
}

/** The decisions the most work rests on: see keystones. */
export async function keystoneDecisions(userId: string, limit?: number) {
  return keystones(await syncedGraph(userId), limit);
}

/** A receipt as nodes and relationships, for drawing: see receiptView. */
export async function viewReceipt(userId: string, receiptId: string) {
  return receiptView(await syncedGraph(userId), receiptId);
}

/**
 * Projects a just-saved baton, so what it says was tried is tied to the pages
 * that stood when it was left, not whatever stands at the first read after.
 * Best effort: the graph catching up later only loosens that.
 */
export async function noteBaton(userId: string): Promise<void> {
  await syncedGraph(userId).catch((e) => console.error("Projecting a new baton failed", e));
}
