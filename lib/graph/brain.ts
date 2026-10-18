import type { Graph } from "falkordb";
import { read } from "./client";
import { CHAIN, impactOf, resolve } from "./context";

// The notebook as a team's memory: who knows what, and which decisions the
// most work rests on.
//
// "Knowing" here is what the graph can show, not a guess: an agent knows a
// decision when it recorded it or was handed it in a receipt. Whether that
// knowledge is current depends on which version it holds: the page that
// stands now, or one a witnessed replacement has retired since.

const LIMIT = 6;

export type Knower = { agent: string; how: "recorded" | "handed"; at: number | null; current: boolean; page: number | null };

export type Known = {
  /** The page that stands now for what was found. */
  note: { id: string; page: number | null; title: string; witnessed: boolean; source: string | null };
  /** Earlier pages it replaced, oldest last. */
  replaced: number[];
  files: string[];
  knowers: Knower[];
};

/** The pages that stand now for a set of notes, each with how strongly it was found. */
async function heads(graph: Graph, found: { id: string; score: number }[]) {
  const resolved = await resolve(graph, found.map((f) => f.id));
  const best = new Map<string, number>();
  for (const f of found) {
    const r = resolved.get(f.id);
    if (!r) continue;
    // A conflict has several heads; each one stands for it.
    const ids = r.heads.length > 0 ? r.heads.map((h) => h.id!) : [r.id];
    for (const id of ids) best.set(id, (best.get(id) ?? 0) + f.score);
  }
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, LIMIT).map(([id]) => id);
}

async function describe(graph: Graph, ids: string[]): Promise<Known[]> {
  if (ids.length === 0) return [];
  const rows = await read<{
    id: string; page: number | null; title: string; witnessed: boolean; source: string | null; replaced: number[]; files: string[];
  }>(
    graph,
    `UNWIND $ids AS id
     MATCH (n:Note {id: id})
     OPTIONAL MATCH (n)-[:SUPERSEDES*1..${CHAIN}]->(old:Note)
     OPTIONAL MATCH (n)-[:ABOUT_FILE]->(f:File)
     RETURN id, n.page AS page, n.title AS title, n.witnessed AS witnessed, n.source AS source,
            collect(DISTINCT old.page) AS replaced, collect(DISTINCT f.path) AS files`,
    { ids },
  );
  // Agents handed this page or any version it replaced, in a receipt nothing refreshed.
  const handed = await read<{ id: string; agent: string; at: number; page: number | null; current: boolean }>(
    graph,
    `UNWIND $ids AS id
     MATCH (n:Note {id: id})-[:SUPERSEDES*0..${CHAIN}]->(v:Note)<-[d:DELIVERED]-(r:Receipt)<-[:RECEIVED]-(a:Agent)
     WHERE NOT ()-[:REFRESHES]->(r)
     RETURN id, a.name AS agent, max(r.at) AS at, d.page AS page, v.id = id AS current`,
    { ids },
  );
  return ids.flatMap((id) => {
    const n = rows.find((r) => r.id === id);
    if (!n) return [];
    const knowers: Knower[] = [];
    if (n.source) knowers.push({ agent: n.source, how: "recorded", at: null, current: true, page: n.page });
    // An agent's newest receipt for the topic decides whether what it holds is current.
    const byAgent = new Map<string, (typeof handed)[number]>();
    for (const h of handed.filter((h) => h.id === id)) {
      const had = byAgent.get(h.agent);
      if (!had || h.at > had.at) byAgent.set(h.agent, h);
    }
    for (const h of byAgent.values()) knowers.push({ agent: h.agent, how: "handed", at: h.at, current: h.current, page: h.page });
    return [{
      note: { id, page: n.page, title: n.title, witnessed: n.witnessed, source: n.source },
      replaced: n.replaced.filter((p) => p != null).sort((a, b) => b - a),
      files: n.files.filter(Boolean),
      knowers,
    }];
  });
}

// Full-text syntax (RediSearch) treats these as operators; a topic is plain words.
const plain = (q: string) => q.replace(/[^\p{L}\p{N}\s_./-]/gu, " ").trim();

/**
 * What the notebook knows about a topic (words in notes' titles and text) or
 * a file (a path, or the end of one), as the pages that stand now, and which
 * agents know it: whether they wrote it, or were handed it and still hold the
 * current version.
 */
export async function whoKnows(graph: Graph, find: { topic?: string; file?: string }): Promise<Known[]> {
  const found: { id: string; score: number }[] = [];
  if (find.topic && plain(find.topic)) {
    const words = plain(find.topic).split(/\s+/).filter((w) => w.length > 1).join(" | ");
    found.push(
      ...(await read<{ id: string; score: number }>(
        graph,
        `CALL db.idx.fulltext.queryNodes('Note', $q) YIELD node, score
         WHERE node.deleted = false
         RETURN node.id AS id, score ORDER BY score DESC LIMIT 20`,
        { q: words },
      )),
    );
  }
  if (find.file?.trim()) {
    found.push(
      ...(await read<{ id: string; score: number }>(
        graph,
        `MATCH (n:Note)-[:ABOUT_FILE]->(f:File)
         WHERE n.deleted = false AND (f.path = $file OR f.path ENDS WITH $suffix)
         RETURN n.id AS id, 1.0 AS score LIMIT 50`,
        { file: find.file.trim(), suffix: `/${find.file.trim().replace(/^\/+/, "")}` },
      )),
    );
  }
  return describe(graph, await heads(graph, found));
}

export type Keystone = {
  note: { id: string; page: number | null; title: string };
  /** PageRank over DEPENDS_ON, summed over the page and every version it replaced. */
  score: number;
  openWork: number;
  agents: string[];
};

/**
 * The decisions the most work rests on: PageRank over DEPENDS_ON (a task or
 * note that depends on a decision passes it weight, and a decision depended
 * on by much-depended-on work gets more), credited to the page that stands
 * now. These are the pages to change most carefully.
 */
export async function keystones(graph: Graph, limit = 5): Promise<Keystone[]> {
  const ranked = await read<{ id: string; score: number }>(
    graph,
    `CALL algo.pageRank(NULL, 'DEPENDS_ON') YIELD node, score
     WITH node, score WHERE node:Note AND node.deleted = false
     MATCH (node)<-[:DEPENDS_ON]-()
     RETURN DISTINCT node.id AS id, score`,
  );
  if (ranked.length === 0) return [];
  const resolved = await resolve(graph, ranked.map((r) => r.id));
  const total = new Map<string, number>();
  for (const r of ranked) {
    const head = resolved.get(r.id)?.heads[0]?.id ?? r.id;
    total.set(head, (total.get(head) ?? 0) + r.score);
  }
  const top = [...total].sort((a, b) => b[1] - a[1]).slice(0, limit);
  return Promise.all(
    top.map(async ([id, score]) => {
      const impact = (await impactOf(graph, id))!;
      return {
        note: impact.note,
        score,
        openWork: impact.dependents.filter((d) => d.status === "open" || d.status === "OPEN" || d.status === "PICKED_UP").length,
        agents: [...new Set(impact.told.map((t) => t.agent))],
      };
    }),
  );
}
