import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "falkordb";
import { graphFor, read, run } from "./client";
import { attemptsFor, reopened } from "./context";
import { formatAttempts, formatReopened } from "./format";
import { projectAttempts } from "./project";

// Procedural memory against a real FalkorDB (FALKORDB_URL): what a baton says
// was ruled out, tied to the pages that stood when it was left.

const url = process.env.FALKORDB_URL;
const A = `test-attempts-${process.pid}`;

describe.skipIf(!url)("ruled-out attempts", () => {
  let g: Graph;

  beforeAll(async () => {
    g = await graphFor(A);
    await run(g, "MATCH (n) DETACH DELETE n");
    // The retry task rests on page 1, replaced (witnessed) by page 3. An old
    // baton for it ruled out a retry loop; a new baton for the same task
    // comes later. Page 5 belongs to unrelated work.
    await run(
      g,
      `CREATE (p1:Note {id: 'p1', page: 1, title: 'Retry checkout on 5xx', hash: 'h1', witnessed: true, deleted: false}),
              (p3:Note {id: 'p3', page: 3, title: 'No retries until idempotency keys', hash: 'h3', witnessed: true, deleted: false}),
              (p5:Note {id: 'p5', page: 5, title: 'Deploy notes', hash: 'h5', witnessed: true, deleted: false}),
              (p3)-[:SUPERSEDES {accepted: true}]->(p1),
              (t:Task {id: 't1', title: 'Add retry to checkout', done: false}),
              (t)-[:DEPENDS_ON]->(p1),
              (old:Handoff {id: 'old', goal: 'Retry checkout', status: 'PICKED_UP'}), (old)-[:FOR]->(t),
              (new:Handoff {id: 'new', goal: 'Retry checkout, again', status: 'OPEN'}), (new)-[:FOR]->(t),
              (other:Handoff {id: 'other', goal: 'Deploy', status: 'OPEN'}), (other)-[:PINS]->(p5)`,
    );
    await projectAttempts(g, [
      { id: "old", source: "codex", at: 1, tried: ["A client-side retry loop: rejected, no retries until idempotency keys"] },
      { id: "other", source: "claude-code", at: 2, tried: ["Blue-green deploy: no second cluster"] },
    ]);
  });

  afterAll(async () => {
    await g?.delete().catch(() => {});
  });

  it("ties an attempt to the task and to the pages that stood when it was ruled out", async () => {
    const rows = await read<{ page: number }>(g, "MATCH (:Attempt {id: 'old:0'})-[:ASSUMED]->(n:Note) RETURN n.page AS page");
    expect(rows.map((r) => r.page)).toEqual([3]);
    const [on] = await read<{ n: number }>(g, "MATCH (:Attempt {id: 'old:0'})-[:ON]->(:Task {id: 't1'}) RETURN count(*) AS n");
    expect(on.n).toBe(1);
  });

  it("hands a later baton for the same task the earlier attempts, and keeps other work's out", async () => {
    const found = await attemptsFor(g, "new");
    expect(found.map((a) => a.id)).toEqual(["old:0"]);
    expect(reopened(found[0])).toBe(false);
    expect(formatAttempts(found)).toMatch(/Its premises still stand: p\. 3/);
    expect((await attemptsFor(g, "other")).map((a) => a.id)).toEqual(["other:0"]);
  });

  it("says an attempt may be worth retrying once a premise is replaced", async () => {
    await run(
      g,
      `MATCH (p3:Note {id: 'p3'})
       CREATE (p6:Note {id: 'p6', page: 6, title: 'Idempotency keys shipped', hash: 'h6', witnessed: true, deleted: false})-[:SUPERSEDES {accepted: true}]->(p3)`,
    );
    const [a] = await attemptsFor(g, "new");
    expect(a.premises).toEqual([{ page: 3, title: "No retries until idempotency keys", replacedBy: { page: 6, title: "Idempotency keys shipped" } }]);
    expect(formatReopened([a])).toMatch(/p\. 3 .* replaced by p\. 6 .*may be worth retrying/);
  });

  it("links an attempt once: re-projecting doesn't move its premises", async () => {
    await projectAttempts(g, [{ id: "old", source: "codex", at: 1, tried: ["A client-side retry loop: rejected, no retries until idempotency keys"] }]);
    const rows = await read<{ page: number }>(g, "MATCH (:Attempt {id: 'old:0'})-[:ASSUMED]->(n:Note) RETURN n.page AS page");
    expect(rows.map((r) => r.page)).toEqual([3]);
  });
});
