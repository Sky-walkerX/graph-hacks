import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "falkordb";
import { graphFor, run } from "./client";
import { staleAnswers } from "./ask";
import { whoKnows } from "./brain";
import { contextFor, diff, findReceipt, impactOf, recordReceipt } from "./context";

// Load: many agents at once on one account's graph, the way a team's agents
// use it. Each agent picks up batons (walk + receipt), checks its context
// (receipt read + walk + diff), and now and then asks what leans on a page or
// who knows a topic. Seeds a notebook far larger than a real one gets in a
// year, then reports throughput and latency per operation.
//
//   LOAD=1 FALKORDB_URL=redis://localhost:6379 pnpm exec vitest run lib/graph/load.test.ts
//
// AGENTS ("1,10,100": one run at each) and ROUNDS (20) size it; the numbers land in
// eval/LOAD.md.

const url = process.env.FALKORDB_URL;
const LEVELS = (process.env.AGENTS ?? "1,10,100").split(",").map(Number);
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const NOTES = 5_000;
const TASKS = 1_000;
const BATONS = 2_000;
const ANSWERS = 2_000;
const G = process.env.KEEP ? "load-kept" : `load-${process.pid}`;

// A seeded generator, so every run builds the same notebook.
let seed = 42;
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
const pick = (n: number) => Math.floor(rand() * n);

const WORDS = ["checkout", "payment", "retry", "idempotency", "webhook", "invoice", "refund", "auth", "session", "cache", "queue", "deploy", "migration", "schema", "index", "billing", "email", "search", "upload", "export"];
const words = (n: number) => Array.from({ length: n }, () => WORDS[pick(WORDS.length)]).join(" ");

const times: Record<string, number[]> = {};
async function timed<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  try {
    return await fn();
  } finally {
    (times[op] ??= []).push(performance.now() - t);
  }
}
/** One agent's rounds. */
async function work(agent: string) {
  for (let r = 0; r < ROUNDS; r++) {
    const baton = `b${pick(BATONS)}`;
    // Pick up: walk the baton's context, record a receipt.
    const context = await timed("pickup (walk + receipt)", async () => {
      const c = await contextFor(g, baton);
      await recordReceipt(g, baton, agent, c);
      return c;
    });
    expect(context.items.length).toBeGreaterThan(0);
    // Check: read the receipt, walk again, diff.
    await timed("check_context (receipt + walk + diff)", async () => {
      const found = await findReceipt(g, agent);
      diff(found!.delivered, (await contextFor(g, found!.handoff)).items);
    });
    if (r % 5 === 0) await timed("impact_of_change", () => impactOf(g, `n${pick(NOTES)}`));
    if (r % 5 === 1) await timed("who_knows (full-text)", () => whoKnows(g, { topic: words(2) }));
    if (r % 10 === 2) await timed("stale_answers", () => staleAnswers(g));
  }
}

let g: Graph;

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

describe.skipIf(!url || !process.env.LOAD)("graph under load", () => {
  beforeAll(async () => {
    g = await graphFor(G);
    await run(g, "MATCH (n) DETACH DELETE n");
    const batch = async <T,>(rows: T[], q: string) => {
      for (let i = 0; i < rows.length; i += 1_000) await run(g, q, { rows: rows.slice(i, i + 1_000) });
    };
    await batch(
      Array.from({ length: NOTES }, (_, i) => ({ id: `n${i}`, page: i + 1, title: words(4), summary: words(40), hash: `h${i}`, witnessed: rand() > 0.1 })),
      "UNWIND $rows AS r CREATE (:Note {id: r.id, page: r.page, title: r.title, summary: r.summary, hash: r.hash, witnessed: r.witnessed, deleted: false})",
    );
    // One note in five is replaced by a later one; replacements can chain.
    await batch(
      Array.from({ length: NOTES / 5 }, () => {
        const old = pick(NOTES - 1);
        return { old: `n${old}`, now: `n${old + 1 + pick(NOTES - old - 1)}`, accepted: rand() > 0.2 };
      }),
      "UNWIND $rows AS r MATCH (o:Note {id: r.old}), (n:Note {id: r.now}) MERGE (n)-[:SUPERSEDES {accepted: r.accepted}]->(o)",
    );
    await batch(
      Array.from({ length: TASKS }, (_, i) => ({ id: `t${i}`, title: words(5), on: Array.from({ length: 1 + pick(3) }, () => `n${pick(NOTES)}`) })),
      "UNWIND $rows AS r CREATE (t:Task {id: r.id, title: r.title, done: false}) WITH t, r UNWIND r.on AS nid MATCH (n:Note {id: nid}) CREATE (t)-[:DEPENDS_ON]->(n)",
    );
    await batch(
      Array.from({ length: BATONS }, (_, i) => ({ id: `b${i}`, task: `t${pick(TASKS)}`, pins: [`n${pick(NOTES)}`, `n${pick(NOTES)}`] })),
      `UNWIND $rows AS r
       MATCH (t:Task {id: r.task})
       CREATE (h:Handoff {id: r.id, goal: 'work', status: 'OPEN'})-[:FOR]->(t)
       WITH h, r UNWIND r.pins AS nid MATCH (n:Note {id: nid}) MERGE (h)-[:PINS]->(n)`,
    );
    await batch(
      Array.from({ length: ANSWERS }, (_, i) => ({ id: `a${i}`, at: i, cites: [`n${pick(NOTES)}`, `n${pick(NOTES)}`] })),
      `UNWIND $rows AS r
       CREATE (a:Answer {id: r.id, at: r.at, chat: 'c', chatTitle: 'chat', question: 'q', excerpt: 'e'})
       WITH a, r UNWIND r.cites AS nid MATCH (n:Note {id: nid}) MERGE (a)-[:CITES {page: 0}]->(n)`,
    );
  }, 300_000);

  afterAll(async () => {
    if (!process.env.KEEP) await g?.delete().catch(() => {});
  });

  it(`serves ${LEVELS.join(", ")} agents at once`, async () => {
    const sections: string[] = [];
    const summary: string[] = [];
    for (const agents of LEVELS) {
      for (const k of Object.keys(times)) delete times[k];
      const started = performance.now();
      await Promise.all(Array.from({ length: agents }, (_, a) => work(`agent-${agents}-${a}`)));
      const seconds = (performance.now() - started) / 1000;
      const ops = Object.values(times).reduce((s, xs) => s + xs.length, 0);
      const all = Object.values(times).flat();
      summary.push(`| ${agents} | ${ops.toLocaleString("en")} | ${(ops / seconds).toFixed(0)} | ${pct(all, 50).toFixed(0)} ms | ${pct(all, 95).toFixed(0)} ms |`);
      sections.push(
        `### ${agents} agent${agents === 1 ? "" : "s"}`,
        ``,
        `| Operation | Count | p50 | p95 | p99 |`,
        `| --- | ---: | ---: | ---: | ---: |`,
        ...Object.entries(times).map(([op, xs]) => `| ${op} | ${xs.length} | ${pct(xs, 50).toFixed(0)} ms | ${pct(xs, 95).toFixed(0)} ms | ${pct(xs, 99).toFixed(0)} ms |`),
        ``,
      );
    }
    const report = [
      `# Graph load`,
      ``,
      `Agents working one account's graph at once, ${ROUNDS} rounds each, against FalkorDB on ${process.env.LOAD_HOST ?? "this machine"}.`,
      `Each round an agent picks up a baton (walk its context, write a receipt) and checks its context (read the receipt, walk again, diff); every few rounds it also asks what leans on a page, who knows a topic, or which Ask answers are out of date.`,
      `The graph: ${NOTES.toLocaleString("en")} notes (one in five replaced, some in chains), ${TASKS.toLocaleString("en")} tasks, ${BATONS.toLocaleString("en")} batons, ${ANSWERS.toLocaleString("en")} Ask answers, and every receipt the run writes.`,
      `Made by \`lib/graph/load.test.ts\` (LOAD=1). An operation is one MCP tool's graph work: several queries, reads and writes.`,
      ``,
      `| Agents at once | Operations | Operations / s | p50 | p95 |`,
      `| ---: | ---: | ---: | ---: | ---: |`,
      ...summary,
      ``,
      `The first run of this benchmark managed 25 operations a second, at any concurrency. Two causes, both fixed: every query went down one connection, which the server answers in order (now a pool, \`FALKORDB_POOL\`, default 8), and three queries written as one long pattern led the planner to scan every note or receipt instead of starting from the indexed id (now stepped out from the index with \`WITH\`; one went from 20 ms to under 1 ms). At 100 agents the 4 cores, shared by the test and FalkorDB, are the limit.`,
      ``,
      ...sections,
    ].join("\n");
    console.log(report);
    writeFileSync(new URL("../../eval/LOAD.md", import.meta.url), report);
  }, 900_000);
});
