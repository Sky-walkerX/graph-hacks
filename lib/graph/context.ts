import { randomUUID } from "node:crypto";
import type { Graph } from "falkordb";
import { read, run } from "./client";

// What a baton's next agent needs to read, worked out from the graph, and the
// receipt that records what it was given.
//
// A baton's context starts at the pages it pins, the note it's about, and the
// notes its task depends on, then follows DEPENDS_ON a few steps further.
// Each note found is then followed through the replacements the user has
// witnessed to the page that stands now: a pinned page that was replaced
// since is delivered as its replacement, with the chain that led there.
// Replacements still waiting to be witnessed are delivered as warnings, never
// as the current page.
//
// The receipt keeps the exact revision of every page delivered (a hash of its
// text) and the path that made it relevant. Comparing a receipt with the
// context worked out again now says what changed since the agent read it.

/** How far a baton's context reaches: baton → task → note → note → note. */
export const CONTEXT_HOPS = 4;
/** The longest chain of replacements followed. */
export const CHAIN = 8;
/** The most notes a context delivers. */
export const MAX_NOTES = 12;

export type Step = { kind: string; id: string; label: string; page: number | null };

export type Item = {
  /** The page that stands now. */
  id: string;
  page: number | null;
  title: string;
  hash: string;
  witnessed: boolean;
  /** How the baton reaches the note it started from. */
  via: Step[];
  /** The note the path reached, when a witnessed replacement stands in for it. */
  replaces: { id: string; page: number | null; title: string; chain: number[] } | null;
  /** Replacements of this page waiting for the user to witness them. */
  proposals: { id: string; page: number | null; title: string; source: string | null }[];
  /** Other pages that also replace it as witnessed: the user hasn't chosen. */
  conflicts: { id: string; page: number | null; title: string }[];
};

type Reached = { id: string; via: Step[]; hops: number };

/** A path as a receipt keeps it: "baton → task "Add retry" → p. 9". */
export const whyOf = (via: Step[]) =>
  via.map((s) => (s.kind === "Note" ? (s.page != null ? `p. ${s.page}` : `"${s.label}"`) : `${s.kind === "Handoff" ? "baton" : s.kind.toLowerCase()} "${s.label}"`)).join(" → ");

const STEP = `[x IN nodes(p) | {kind: labels(x)[0], id: x.id, label: coalesce(x.title, x.goal, x.id), page: x.page}]`;

/** The notes a baton reaches, each by its shortest path. */
async function reach(graph: Graph, handoffId: string): Promise<Reached[]> {
  const rows = await read<{ id: string; via: Step[]; hops: number }>(
    graph,
    `MATCH p = (h:Handoff {id: $h})-[:PINS|ABOUT|FOR|DEPENDS_ON*1..${CONTEXT_HOPS}]->(n:Note)
     WHERE n.deleted = false
     RETURN n.id AS id, ${STEP} AS via, length(p) AS hops`,
    { h: handoffId },
  );
  const best = new Map<string, Reached>();
  for (const r of rows) {
    const had = best.get(r.id);
    if (!had || r.hops < had.hops) best.set(r.id, r);
  }
  return [...best.values()].sort((a, b) => a.hops - b.hops);
}

type Head = { id: string | null; page: number | null; title: string | null; hash: string | null; witnessed: boolean | null; chain: number[] };

/** Each note followed through witnessed replacements to the pages that stand now. */
export async function resolve(graph: Graph, ids: string[]) {
  const rows = await read<{
    id: string; page: number | null; title: string; hash: string; witnessed: boolean; heads: Head[];
  }>(
    graph,
    `UNWIND $ids AS id
     MATCH (n:Note {id: id})
     OPTIONAL MATCH p = (n)<-[:SUPERSEDES*1..${CHAIN} {accepted: true}]-(cur:Note)
     WHERE NOT (cur)<-[:SUPERSEDES {accepted: true}]-(:Note)
     RETURN id, n.page AS page, n.title AS title, n.hash AS hash, n.witnessed AS witnessed,
            collect(DISTINCT {id: cur.id, page: cur.page, title: cur.title, hash: cur.hash, witnessed: cur.witnessed,
                              chain: [x IN nodes(p) | x.page]}) AS heads`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, { ...r, heads: r.heads.filter((h) => h.id) }]));
}

async function proposalsFor(graph: Graph, ids: string[]) {
  const rows = await read<{ id: string; proposals: Item["proposals"] }>(
    graph,
    `UNWIND $ids AS id
     MATCH (n:Note {id: id})<-[:SUPERSEDES {accepted: false}]-(p:Note)
     WHERE p.deleted = false
     RETURN id, collect({id: p.id, page: p.page, title: p.title, source: p.source}) AS proposals`,
    { ids },
  );
  return new Map(rows.map((r) => [r.id, r.proposals]));
}

/** The context a baton delivers now. */
export async function contextFor(graph: Graph, handoffId: string): Promise<{ items: Item[]; truncated: boolean }> {
  const reached = await reach(graph, handoffId);
  const resolved = await resolve(graph, reached.map((r) => r.id));
  const items = new Map<string, Item>();
  for (const r of reached) {
    const n = resolved.get(r.id);
    if (!n) continue;
    const [head, ...others] = n.heads;
    const cur = head ?? { id: n.id, page: n.page, title: n.title, hash: n.hash, witnessed: n.witnessed, chain: [] };
    // Two paths can reach the same page; the shorter one (first) explains it.
    if (items.has(cur.id!)) continue;
    items.set(cur.id!, {
      id: cur.id!,
      page: cur.page,
      title: cur.title ?? "",
      hash: cur.hash ?? "",
      witnessed: Boolean(cur.witnessed),
      via: r.via,
      replaces: head ? { id: n.id, page: n.page, title: n.title, chain: head.chain } : null,
      proposals: [],
      conflicts: others.map((o) => ({ id: o.id!, page: o.page, title: o.title ?? "" })),
    });
  }
  const all = [...items.values()];
  const kept = all.slice(0, MAX_NOTES);
  const proposals = await proposalsFor(graph, kept.map((i) => i.id));
  for (const i of kept) i.proposals = proposals.get(i.id) ?? [];
  return { items: kept, truncated: all.length > kept.length };
}

export type Receipt = { id: string; at: number; agent: string; handoff: string; items: Item[]; warnings: string[] };

/** Warnings a context carries: what the agent must not take as settled. */
export function warningsOf(items: Item[], truncated: boolean): string[] {
  const w: string[] = [];
  for (const i of items) {
    const p = i.page ? `page ${i.page}` : `"${i.title}"`;
    if (!i.witnessed) w.push(`${p} is recorded by an agent and not witnessed yet: treat it as a proposal.`);
    for (const pr of i.proposals) w.push(`${p} has a replacement waiting to be witnessed (page ${pr.page}, "${pr.title}"): it may be about to change.`);
    if (i.conflicts.length) w.push(`${p} and ${i.conflicts.map((c) => `page ${c.page}`).join(", ")} each replace the same page and are all witnessed: ask the user which one stands.`);
  }
  if (truncated) w.push(`Only the ${MAX_NOTES} closest pages are included.`);
  return w;
}

/** Records what `agent` was given for a baton, and returns the receipt. */
export async function recordReceipt(
  graph: Graph,
  handoffId: string,
  agent: string,
  context: { items: Item[]; truncated: boolean },
  refreshes?: string,
): Promise<Receipt> {
  const receipt: Receipt = {
    id: randomUUID(),
    at: Date.now(),
    agent,
    handoff: handoffId,
    items: context.items,
    warnings: warningsOf(context.items, context.truncated),
  };
  await run(
    graph,
    `MATCH (h:Handoff {id: $h})
     MERGE (a:Agent {name: $agent})
     CREATE (a)-[:RECEIVED]->(r:Receipt {id: $id, at: $at, agent: $agent, handoff: $h, warnings: $warnings})-[:FOR]->(h)`,
    { h: handoffId, agent, id: receipt.id, at: receipt.at, warnings: receipt.warnings },
  );
  await run(
    graph,
    `MATCH (r:Receipt {id: $id})
     UNWIND $items AS it
     MATCH (n:Note {id: it.id})
     CREATE (r)-[:DELIVERED {hash: it.hash, witnessed: it.witnessed, page: it.page, title: it.title, why: it.why, replaced: it.replaced}]->(n)`,
    {
      id: receipt.id,
      items: context.items.map((i) => ({
        id: i.id, hash: i.hash, witnessed: i.witnessed, page: i.page, title: i.title,
        why: whyOf(i.via),
        replaced: i.replaces?.id ?? null,
      })),
    },
  );
  if (refreshes) {
    await run(graph, "MATCH (r:Receipt {id: $id}), (old:Receipt {id: $old}) CREATE (r)-[:REFRESHES]->(old)", { id: receipt.id, old: refreshes });
  }
  return receipt;
}

export type Delivered = {
  id: string;
  page: number | null;
  title: string;
  hash: string;
  witnessed: boolean;
  /** The path that made it relevant, as recorded: "this baton → task → p. 9". */
  why: string;
  nowHash: string | null;
  deleted: boolean;
};

/** A receipt and what it delivered. With no id, the agent's newest one that nothing refreshed. */
export async function findReceipt(graph: Graph, agent: string, id?: string) {
  const [r] = await read<{ id: string; at: number; agent: string; handoff: string; warnings: string[]; refreshed: boolean }>(
    graph,
    id
      ? `MATCH (r:Receipt {id: $id}) RETURN r.id AS id, r.at AS at, r.agent AS agent, r.handoff AS handoff, r.warnings AS warnings,
           size([()-[:REFRESHES]->(r) | 1]) > 0 AS refreshed`
      : `MATCH (:Agent {name: $agent})-[:RECEIVED]->(r:Receipt) WHERE NOT ()-[:REFRESHES]->(r)
         RETURN r.id AS id, r.at AS at, r.agent AS agent, r.handoff AS handoff, r.warnings AS warnings, false AS refreshed
         ORDER BY r.at DESC LIMIT 1`,
    { id, agent },
  );
  if (!r) return null;
  const delivered = await read<Delivered>(
    graph,
    `MATCH (:Receipt {id: $id})-[d:DELIVERED]->(n:Note)
     RETURN n.id AS id, d.page AS page, d.title AS title, d.hash AS hash, d.witnessed AS witnessed, d.why AS why,
            n.hash AS nowHash, n.deleted AS deleted`,
    { id: r.id },
  );
  return { ...r, delivered };
}

export type Change =
  | { kind: "replaced"; was: Delivered; now: Item }
  | { kind: "edited"; was: Delivered; now: Item }
  | { kind: "witnessed"; was: Delivered; now: Item }
  | { kind: "withdrawn"; was: Delivered }
  | { kind: "dropped"; was: Delivered }
  | { kind: "added"; now: Item };

/** What changed between what a receipt delivered and the context now. */
export function diff(delivered: Delivered[], now: Item[]): Change[] {
  const changes: Change[] = [];
  const matched = new Set<string>();
  for (const d of delivered) {
    const same = now.find((i) => i.id === d.id);
    if (same) {
      matched.add(same.id);
      if (same.hash !== d.hash) changes.push({ kind: "edited", was: d, now: same });
      else if (same.witnessed && !d.witnessed) changes.push({ kind: "witnessed", was: d, now: same });
      continue;
    }
    // Replaced: a page now stands where this one was, through a witnessed replacement.
    const repl = now.find((i) => i.replaces?.id === d.id || (i.replaces && i.replaces.chain.includes(d.page ?? -1)));
    if (repl) {
      matched.add(repl.id);
      changes.push({ kind: "replaced", was: d, now: repl });
    } else changes.push({ kind: d.deleted ? "withdrawn" : "dropped", was: d });
  }
  for (const i of now) if (!matched.has(i.id) && !delivered.some((d) => d.id === i.id)) changes.push({ kind: "added", now: i });
  return changes;
}

export type Impact = {
  note: { id: string; page: number | null; title: string };
  /** Tasks, batons and notes that lean on it, each with the path that says so. */
  dependents: { kind: string; id: string; label: string; status: string | null; path: Step[] }[];
  /** Agents given it (or a page that leans on it) in a receipt nothing has refreshed; `stale` when what they were given has been replaced since. */
  told: { agent: string; receipt: string; at: number; handoff: string; page: number | null; stale: boolean }[];
};

/**
 * What leans on a note, or on the notes it replaces: the tasks, batons and
 * notes that depend on it, and the agents that were handed it. This is what
 * needs another look when the note changes.
 */
export async function impactOf(graph: Graph, noteId: string): Promise<Impact | null> {
  const [note] = await read<Impact["note"]>(graph, "MATCH (n:Note {id: $id}) RETURN n.id AS id, n.page AS page, n.title AS title", { id: noteId });
  if (!note) return null;
  const dependents = await read<Impact["dependents"][number]>(
    graph,
    `MATCH (d:Note {id: $id})-[:SUPERSEDES*0..${CHAIN}]->(base:Note)
     WITH DISTINCT base
     MATCH p = (x)-[:DEPENDS_ON|FOR|PINS|ABOUT*1..${CONTEXT_HOPS}]->(base)
     WHERE (x:Task OR x:Handoff OR x:Note) AND x.id <> $id
     RETURN labels(x)[0] AS kind, x.id AS id, coalesce(x.title, x.goal) AS label,
            CASE WHEN x:Handoff THEN x.status WHEN x:Task THEN CASE WHEN x.done THEN 'done' ELSE 'open' END ELSE null END AS status,
            ${STEP} AS path, length(p) AS hops
     ORDER BY hops`,
    { id: noteId },
  );
  const seen = new Set<string>();
  const unique = dependents.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
  const told = await read<Impact["told"][number]>(
    graph,
    `MATCH (d:Note {id: $id})-[:SUPERSEDES*0..${CHAIN}]->(base:Note)
     WITH DISTINCT base
     MATCH (a:Agent)-[:RECEIVED]->(r:Receipt)-[dl:DELIVERED]->(n:Note)-[:DEPENDS_ON*0..${CONTEXT_HOPS}]->(base)
     WHERE NOT ()-[:REFRESHES]->(r)
     RETURN DISTINCT a.name AS agent, r.id AS receipt, r.at AS at, r.handoff AS handoff, dl.page AS page,
            size([(n)<-[:SUPERSEDES {accepted: true}]-(:Note) | 1]) > 0 AS stale
     ORDER BY at DESC`,
    { id: noteId },
  );
  return { note, dependents: unique, told };
}

/** Says `from` (a task or a note) depends on note `to`. Refuses a loop. */
export async function linkDependency(
  graph: Graph,
  from: string,
  to: string,
  by: string,
  reason: string | null,
): Promise<"linked" | "missing-from" | "missing-to" | "loop"> {
  const [ends] = await read<{ from: boolean; to: boolean; loop: boolean }>(
    graph,
    `OPTIONAL MATCH (f) WHERE (f:Task OR f:Note) AND f.id = $from
     OPTIONAL MATCH (t:Note {id: $to})
     RETURN f IS NOT NULL AS from, t IS NOT NULL AS to,
            CASE WHEN f IS NULL OR t IS NULL THEN false
                 ELSE id(f) = id(t) OR size([(t)-[:DEPENDS_ON*1..${CHAIN}]->(f) | 1]) > 0 END AS loop`,
    { from, to },
  );
  if (!ends?.from) return "missing-from";
  if (!ends.to) return "missing-to";
  if (ends.loop) return "loop";
  await run(
    graph,
    `MATCH (f) WHERE (f:Task OR f:Note) AND f.id = $from
     MATCH (t:Note {id: $to})
     MERGE (f)-[e:DEPENDS_ON]->(t)
     SET e.by = $by, e.at = $at, e.reason = $reason`,
    { from, to, by, at: Date.now(), reason },
  );
  return "linked";
}

/** The agent's current receipt for a task's baton: the newest one nothing refreshed. */
export async function receiptForTask(graph: Graph, agent: string, taskId: string): Promise<string | null> {
  const [r] = await read<{ id: string }>(
    graph,
    `MATCH (:Agent {name: $agent})-[:RECEIVED]->(r:Receipt)-[:FOR]->(:Handoff)-[:FOR]->(:Task {id: $task})
     WHERE NOT ()-[:REFRESHES]->(r)
     RETURN r.id AS id ORDER BY r.at DESC LIMIT 1`,
    { agent, task: taskId },
  );
  return r?.id ?? null;
}

/**
 * Records that `agent` finished a task against the context in its current
 * receipt for it, so the finished work can be traced to the pages it rested
 * on, and flagged when one of them changes later. Null when the agent holds
 * no receipt for the task.
 */
export async function recordOutcome(graph: Graph, agent: string, taskId: string): Promise<string | null> {
  const receipt = await receiptForTask(graph, agent, taskId);
  if (!receipt) return null;
  await run(
    graph,
    `MATCH (t:Task {id: $task}), (r:Receipt {id: $receipt})
     SET t.done = true
     MERGE (t)-[o:DONE_WITH]->(r)
     SET o.at = $at, o.agent = $agent`,
    { task: taskId, receipt, at: Date.now(), agent },
  );
  return receipt;
}

export type Outcome = {
  task: { id: string; title: string; done: boolean };
  agent: string;
  at: number;
  receipt: string;
  delivered: Delivered[];
  /** What changed since the task was finished against that receipt. */
  changes: Change[];
};

/** How tasks were finished: the receipts they were done against, and what changed since. */
export async function outcomes(graph: Graph, taskId?: string): Promise<Outcome[]> {
  const rows = await read<{ task: Outcome["task"]; agent: string; at: number; receipt: string; handoff: string }>(
    graph,
    `MATCH (t:Task)-[o:DONE_WITH]->(r:Receipt)
     WHERE ${taskId ? "t.id = $task" : "t.done = true"}
     RETURN {id: t.id, title: t.title, done: t.done} AS task, o.agent AS agent, o.at AS at, r.id AS receipt, r.handoff AS handoff
     ORDER BY at DESC`,
    { task: taskId },
  );
  return Promise.all(
    rows.map(async (o) => {
      const found = (await findReceipt(graph, o.agent, o.receipt))!;
      const now = await contextFor(graph, o.handoff);
      return { task: o.task, agent: o.agent, at: o.at, receipt: o.receipt, delivered: found.delivered, changes: diff(found.delivered, now.items) };
    }),
  );
}
