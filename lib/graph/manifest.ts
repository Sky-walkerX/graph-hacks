import prisma from "@/lib/prisma";
import type { PinnedPage } from "@/lib/handoff/card";
import { GraphUnavailable, read } from "./client";
import { contextFor, diff, findReceipt, impactOf, linkDependency, recordReceipt, type Change, type Item, type Receipt } from "./context";
import { projectTask, syncedGraph } from "./project";

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

export type Delivery = { receipt: Receipt; pages: PinnedPage[] };

/** Works out a baton's context for `agent`, records the receipt, and returns both. */
export async function deliver(userId: string, agent: string, handoffId: string, refreshes?: string): Promise<Delivery> {
  const graph = await syncedGraph(userId);
  const context = await contextFor(graph, handoffId);
  const receipt = await recordReceipt(graph, handoffId, agent, context, refreshes);
  return { receipt, pages: await pagesOf(userId, context.items) };
}

export type Check = {
  receipt: { id: string; at: number; handoff: string; refreshed: boolean };
  changes: Change[];
  /** The new receipt and the changed pages' text, when asked to refresh and something changed. */
  refreshed: Delivery | null;
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
  let refreshed: Delivery | null = null;
  if (refresh && changes.length > 0) {
    const receipt = await recordReceipt(graph, found.handoff, agent, now, found.id);
    const changed = now.items.filter((i) => changes.some((c) => "now" in c && c.now.id === i.id));
    refreshed = { receipt, pages: await pagesOf(userId, changed) };
  }
  return { receipt: { id: found.id, at: found.at, handoff: found.handoff, refreshed: found.refreshed }, changes, refreshed };
}

/** The changes since `agent` picked up the baton for a task, if it did. Null when it holds no receipt for it. */
export async function changesForTask(userId: string, agent: string, taskId: string): Promise<Change[] | null> {
  const graph = await syncedGraph(userId);
  const [r] = await read<{ id: string }>(
    graph,
    `MATCH (:Agent {name: $agent})-[:RECEIVED]->(r:Receipt)-[:FOR]->(:Handoff)-[:FOR]->(:Task {id: $task})
     WHERE NOT ()-[:REFRESHES]->(r)
     RETURN r.id AS id ORDER BY r.at DESC LIMIT 1`,
    { agent, task: taskId },
  );
  if (!r) return null;
  const found = (await findReceipt(graph, agent, r.id))!;
  return diff(found.delivered, (await contextFor(graph, found.handoff)).items);
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
