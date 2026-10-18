import { createHash } from "node:crypto";
import type { Graph } from "falkordb";
import prisma from "@/lib/prisma";
import { graphFor, read, run } from "./client";
import { projectAnswers, projectDocs } from "./ask";
import { contextFor } from "./context";

// The notebook, projected into the account's graph. Postgres stays the
// authority on notes, tasks and batons; the graph gets what it needs to walk
// them: each note's revision (a hash of its title and text), whether it's
// witnessed, which note it replaces, the files it's about and who recorded
// it, and each baton's task, pinned pages and state.
//
// Every graph operation syncs first, so nothing reads a graph that lags the
// notebook: notes changed since the last sync are written again (a note's
// updatedAt moves on every write, witnessing included), notes deleted since
// are marked deleted rather than removed, since a receipt may still point at
// them, and recent batons and the tasks in the graph are refreshed.
//
// What only the graph holds (dependencies, receipts) is never rebuilt from
// Postgres, so a sync can't lose it.

/** A note's revision: changes whenever its title or text does. */
export const revision = (title: string, notes: string) =>
  createHash("sha256").update(title).update("\0").update(notes).digest("hex").slice(0, 16);

// Writes that land in the same instant as a sync's read can carry a
// timestamp just behind the watermark, so each sync looks a little further
// back. Writing a note twice is harmless.
const OVERLAP_MS = 5_000;
const BATONS = 200;
/** Bumped when what a note's node holds changes, so existing graphs project every note again. */
const VERSION = 3;
/** How much of a note's text its node keeps, for full-text search. */
const SUMMARY = 600;

const syncing = new Map<string, Promise<Graph>>();

/** The account's graph, brought up to date with its notebook first. */
export function syncedGraph(userId: string): Promise<Graph> {
  // One sync per account at a time; callers that arrive meanwhile share it.
  const running = syncing.get(userId);
  if (running) return running;
  const p = sync(userId).finally(() => syncing.delete(userId));
  syncing.set(userId, p);
  return p;
}

async function sync(userId: string): Promise<Graph> {
  const graph = await graphFor(userId);
  const [meta] = await read<{ at: number | null; version: number | null }>(
    graph,
    "MATCH (m:Meta {key: 'sync'}) RETURN m.notesAt AS at, m.version AS version",
  );
  const since = meta?.at && meta.version === VERSION ? new Date(meta.at - OVERLAP_MS) : null;
  const startedAt = Date.now();

  const notes = await prisma.milestone.findMany({
    where: { subject: { userId }, ...(since ? { updatedAt: { gte: since } } : {}) },
    select: {
      id: true, page: true, title: true, notes: true, source: true, witnessedAt: true, updatedAt: true,
      subjectId: true, supersedesId: true, staleReason: true, anchorRepo: true, anchorFiles: true,
    },
  });
  await projectNotes(graph, notes);
  await markDeleted(graph, userId);
  await projectDocs(graph, userId, !since);
  await projectAnswers(graph, userId, !since);
  await projectBatons(graph, userId);
  await refreshTasks(graph, userId);

  const latest = notes.reduce((m, n) => Math.max(m, n.updatedAt.getTime()), meta?.at ?? 0);
  // Never past the moment this sync started reading.
  await run(graph, "MERGE (m:Meta {key: 'sync'}) SET m.notesAt = $at, m.syncedAt = $now, m.version = $version", {
    version: VERSION,
    at: Math.min(Math.max(latest, meta?.at ?? 0), startedAt),
    now: Date.now(),
  });
  return graph;
}

type NoteRow = {
  id: string;
  page: number | null;
  title: string;
  notes: string;
  source: string | null;
  witnessedAt: Date | null;
  updatedAt: Date;
  subjectId: string;
  supersedesId: string | null;
  staleReason: string | null;
  anchorRepo: string | null;
  anchorFiles: string[];
};

const isAgent = (source: string | null) => Boolean(source && source !== "web");

async function projectNotes(graph: Graph, notes: NoteRow[]) {
  if (notes.length === 0) return;
  const rows = notes.map((n) => ({
    id: n.id,
    page: n.page,
    title: n.title,
    summary: n.notes.replace(/\s+/g, " ").trim().slice(0, SUMMARY),
    hash: revision(n.title, n.notes),
    // The user's own notes count as witnessed as they're written.
    witnessed: !isAgent(n.source) || n.witnessedAt !== null,
    source: isAgent(n.source) ? n.source : null,
    subjectId: n.subjectId,
    updatedAt: n.updatedAt.getTime(),
    stale: n.staleReason,
    repo: n.anchorRepo,
  }));
  // A note's own edges are drawn again from what it says now.
  await run(
    graph,
    `UNWIND $rows AS r
     MERGE (n:Note {id: r.id})
     SET n.page = r.page, n.title = r.title, n.summary = r.summary, n.hash = r.hash, n.witnessed = r.witnessed, n.source = r.source,
         n.subjectId = r.subjectId, n.updatedAt = r.updatedAt, n.stale = r.stale, n.repo = r.repo, n.deleted = false
     WITH n
     OPTIONAL MATCH (n)-[e:SUPERSEDES|ABOUT_FILE]->()
     DELETE e`,
    { rows },
  );
  await run(
    graph,
    `UNWIND $rows AS r
     MATCH (n:Note {id: r.id})
     MERGE (a:Agent {name: r.source})
     MERGE (a)-[:RECORDED]->(n)`,
    { rows: rows.filter((r) => r.source) },
  );
  // A replacement counts only once it's witnessed; until then it's a proposal.
  const links = notes
    .filter((n) => n.supersedesId)
    .map((n) => ({ from: n.id, to: n.supersedesId, accepted: !isAgent(n.source) || n.witnessedAt !== null }));
  await run(
    graph,
    `UNWIND $links AS l
     MATCH (n:Note {id: l.from})
     MERGE (o:Note {id: l.to})
     MERGE (n)-[s:SUPERSEDES]->(o)
     SET s.accepted = l.accepted`,
    { links },
  );
  const files = notes.flatMap((n) =>
    n.anchorFiles.map((path) => ({ note: n.id, path, repo: n.anchorRepo, key: `${n.anchorRepo ?? ""}:${path}` })),
  );
  await run(
    graph,
    `UNWIND $files AS f
     MATCH (n:Note {id: f.note})
     MERGE (file:File {key: f.key})
     SET file.path = f.path, file.repo = f.repo
     MERGE (n)-[:ABOUT_FILE]->(file)`,
    { files },
  );
  await run(
    graph,
    `UNWIND $files AS f
     WITH f WHERE f.repo IS NOT NULL
     MATCH (file:File {key: f.key})
     MERGE (r:Repo {name: f.repo})
     MERGE (file)-[:IN_REPO]->(r)`,
    { files },
  );
}

/** Notes gone from the notebook stay in the graph, marked, so old receipts still resolve. */
async function markDeleted(graph: Graph, userId: string) {
  const [{ live } = { live: 0 }] = await read<{ live: number }>(graph, "MATCH (n:Note) WHERE n.deleted = false RETURN count(n) AS live");
  const count = await prisma.milestone.count({ where: { subject: { userId } } });
  if (live === count) return;
  const ids = (await prisma.milestone.findMany({ where: { subject: { userId } }, select: { id: true } })).map((n) => n.id);
  await run(graph, "MATCH (n:Note) WHERE n.deleted = false AND NOT n.id IN $ids SET n.deleted = true", { ids });
}

async function projectBatons(graph: Graph, userId: string) {
  const batons = await prisma.handoff.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: BATONS,
    select: {
      id: true, source: true, goal: true, next: true, status: true, createdAt: true, pickedUpAt: true, pickedUpBy: true,
      repo: true, subjectId: true, noteId: true, pages: true, tried: true, task: { select: { id: true, title: true, isCompleted: true } },
    },
  });
  if (batons.length === 0) return;
  const rows = batons.map((b) => ({
    id: b.id,
    source: b.source,
    goal: b.goal,
    next: b.next,
    status: b.status,
    createdAt: b.createdAt.getTime(),
    pickedUpAt: b.pickedUpAt?.getTime() ?? null,
    pickedUpBy: b.pickedUpBy,
    repo: b.repo,
    subjectId: b.subjectId,
    noteId: b.noteId,
    pages: b.pages,
    task: b.task ? { id: b.task.id, title: b.task.title, done: b.task.isCompleted } : null,
  }));
  await run(
    graph,
    `UNWIND $rows AS b
     MERGE (h:Handoff {id: b.id})
     SET h.source = b.source, h.goal = b.goal, h.next = b.next, h.status = b.status, h.createdAt = b.createdAt,
         h.pickedUpAt = b.pickedUpAt, h.pickedUpBy = b.pickedUpBy, h.repo = b.repo, h.subjectId = b.subjectId
     MERGE (a:Agent {name: b.source})
     MERGE (a)-[:LEFT]->(h)
     WITH h
     OPTIONAL MATCH (h)-[e:FOR|PINS|ABOUT]->()
     DELETE e`,
    { rows },
  );
  await run(
    graph,
    `UNWIND $rows AS b
     WITH b WHERE b.task IS NOT NULL
     MATCH (h:Handoff {id: b.id})
     MERGE (t:Task {id: b.task.id})
     SET t.title = b.task.title, t.done = b.task.done
     MERGE (h)-[:FOR]->(t)`,
    { rows },
  );
  await run(
    graph,
    `UNWIND $rows AS b
     WITH b WHERE b.noteId IS NOT NULL
     MATCH (h:Handoff {id: b.id}), (n:Note {id: b.noteId})
     MERGE (h)-[:ABOUT]->(n)`,
    { rows },
  );
  const pins = rows.flatMap((b) => b.pages.map((page, order) => ({ h: b.id, page, order })));
  await run(
    graph,
    `UNWIND $pins AS p
     MATCH (h:Handoff {id: p.h}), (n:Note {page: p.page})
     WHERE n.deleted = false
     MERGE (h)-[e:PINS]->(n)
     SET e.order = p.order`,
    { pins },
  );
  await projectAttempts(graph, batons.map((b) => ({ id: b.id, source: b.source, at: b.createdAt.getTime(), tried: b.tried })));
}

/**
 * Procedural memory: what a baton says was tried and ruled out becomes an
 * Attempt, tied to the baton's task and to the pages the baton rested on when
 * it was left (ASSUMED). An attempt is linked once, when first seen, so its
 * premises stay the ones it was ruled out under; when one of them is later
 * replaced, the attempt may be worth another go (attemptsFor).
 */
export async function projectAttempts(graph: Graph, batons: { id: string; source: string; at: number; tried: string[] }[]) {
  const attempts = batons.flatMap((b) => b.tried.map((text, i) => ({ id: `${b.id}:${i}`, h: b.id, text, at: b.at, source: b.source })));
  if (attempts.length === 0) return;
  await run(
    graph,
    `UNWIND $attempts AS a
     MATCH (h:Handoff {id: a.h})
     MERGE (x:Attempt {id: a.id})
     ON CREATE SET x.text = a.text, x.at = a.at, x.source = a.source, x.linked = false
     MERGE (h)-[:TRIED]->(x)`,
    { attempts },
  );
  const fresh = await read<{ id: string; h: string }>(graph, "MATCH (h:Handoff)-[:TRIED]->(x:Attempt {linked: false}) RETURN x.id AS id, h.id AS h");
  for (const { id, h } of fresh) {
    const { items } = await contextFor(graph, h);
    await run(
      graph,
      `MATCH (x:Attempt {id: $id})
       OPTIONAL MATCH (:Handoff {id: $h})-[:FOR]->(t:Task)
       FOREACH (_ IN CASE WHEN t IS NULL THEN [] ELSE [1] END | MERGE (x)-[:ON]->(t))
       WITH x
       UNWIND $notes AS nid
       MATCH (n:Note {id: nid})
       MERGE (x)-[:ASSUMED]->(n)`,
      { id, h, notes: items.map((i) => i.id) },
    );
    await run(graph, "MATCH (x:Attempt {id: $id}) SET x.linked = true", { id });
  }
}

/** Titles and completion of the tasks the graph knows, which change without a trace. */
async function refreshTasks(graph: Graph, userId: string) {
  const ids = (await read<{ id: string }>(graph, "MATCH (t:Task) RETURN t.id AS id")).map((t) => t.id);
  if (ids.length === 0) return;
  const tasks = await prisma.task.findMany({ where: { id: { in: ids }, userId }, select: { id: true, title: true, isCompleted: true } });
  await run(
    graph,
    "UNWIND $tasks AS t MATCH (x:Task {id: t.id}) SET x.title = t.title, x.done = t.done",
    { tasks: tasks.map((t) => ({ id: t.id, title: t.title, done: t.isCompleted })) },
  );
}

/** Puts a plan task in the graph (for a dependency), if it's the user's. */
export async function projectTask(graph: Graph, userId: string, taskId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId }, select: { id: true, title: true, isCompleted: true } });
  if (!task) return null;
  await run(graph, "MERGE (t:Task {id: $id}) SET t.title = $title, t.done = $done", { id: task.id, title: task.title, done: task.isCompleted });
  return task;
}
