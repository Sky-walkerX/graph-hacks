import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "falkordb";
import { graphFor, run } from "./client";
import { keystones, whoKnows } from "./brain";
import { contextFor, recordReceipt } from "./context";

// Runs against a real FalkorDB (FALKORDB_URL), on a graph of its own.

const url = process.env.FALKORDB_URL;
const U = `test-brain-${process.pid}`;

describe.skipIf(!url)("who knows what", () => {
  let g: Graph;

  beforeAll(async () => {
    g = await graphFor(U);
    await run(g, "MATCH (n) DETACH DELETE n");
    // Retry policy, replaced once (witnessed). Codex was handed the old page,
    // Cursor the new one. Two tasks lean on the policy, one on the deploy note.
    await run(
      g,
      `CREATE (old:Note {id: 'r1', page: 1, title: 'Checkout retry policy', summary: 'retry payments on 5xx', hash: 'a', witnessed: true, deleted: false, source: 'claude-code'}),
              (cur:Note {id: 'r2', page: 2, title: 'Checkout: no retries', summary: 'payments are not idempotent, do not retry', hash: 'b', witnessed: true, deleted: false, source: 'claude-code'}),
              (dep:Note {id: 'd1', page: 3, title: 'Deploy notes', summary: 'blue green deploys', hash: 'c', witnessed: true, deleted: false}),
              (cur)-[:SUPERSEDES {accepted: true}]->(old),
              (f:File {key: 'acme/shop:lib/checkout/pay.ts', path: 'lib/checkout/pay.ts'}),
              (cur)-[:ABOUT_FILE]->(f), (old)-[:ABOUT_FILE]->(f),
              (t1:Task {id: 't1', title: 'Retry', done: false}), (t2:Task {id: 't2', title: 'Refund', done: false}), (t3:Task {id: 't3', title: 'Ship', done: false}),
              (t1)-[:DEPENDS_ON]->(old), (t2)-[:DEPENDS_ON]->(cur), (t3)-[:DEPENDS_ON]->(dep),
              (h1:Handoff {id: 'h1', status: 'PICKED_UP'})-[:FOR]->(t1),
              (h2:Handoff {id: 'h2', status: 'PICKED_UP'})-[:PINS]->(cur)`,
    );
    // Codex picked up h1 before the replacement: it was handed page 1. Simulate by delivering r1.
    await run(
      g,
      `MATCH (h:Handoff {id: 'h1'}), (n:Note {id: 'r1'})
       CREATE (:Agent {name: 'codex'})-[:RECEIVED]->(r:Receipt {id: 'rc1', at: 1, agent: 'codex', handoff: 'h1', warnings: []})-[:FOR]->(h),
              (r)-[:DELIVERED {hash: 'a', witnessed: true, page: 1, title: 'Checkout retry policy', why: ''}]->(n)`,
    );
    await recordReceipt(g, "h2", "cursor", await contextFor(g, "h2"));
  });

  afterAll(async () => {
    await g?.delete().catch(() => {});
  });

  it("finds the page that stands for a topic, through full-text, and who holds which version", async () => {
    const [top] = await whoKnows(g, { topic: "retry payments" });
    expect(top.note.id).toBe("r2");
    expect(top.replaced).toEqual([1]);
    const by = Object.fromEntries(top.knowers.map((k) => [k.agent, k]));
    expect(by["claude-code"]).toMatchObject({ how: "recorded", current: true });
    expect(by.cursor).toMatchObject({ how: "handed", current: true });
    expect(by.codex).toMatchObject({ how: "handed", current: false, page: 1 });
  });

  it("finds what's known about a file by the end of its path", async () => {
    const found = await whoKnows(g, { file: "checkout/pay.ts" });
    expect(found.map((k) => k.note.id)).toEqual(["r2"]);
  });

  it("ignores full-text operators in a topic", async () => {
    await expect(whoKnows(g, { topic: "retry* | (@title:x)" })).resolves.toBeInstanceOf(Array);
  });

  it("ranks the decision most work rests on first, credited to the page that stands", async () => {
    const ranked = await keystones(g);
    expect(ranked[0].note.id).toBe("r2");
    expect(ranked[0].openWork).toBeGreaterThanOrEqual(2);
    expect(ranked.map((k) => k.note.id)).toContain("d1");
  });
});
