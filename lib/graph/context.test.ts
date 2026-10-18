import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "falkordb";
import { graphFor, read, run } from "./client";
import { contextFor, diff, findReceipt, impactOf, linkDependency, recordReceipt, warningsOf } from "./context";

// Runs against a real FalkorDB (FALKORDB_URL), on graphs of its own. The
// notebook's side is drawn straight into the graph, as lib/graph/project.ts
// would write it, so these cover the walks without a database.

const url = process.env.FALKORDB_URL;
const A = `test-a-${process.pid}`;
const B = `test-b-${process.pid}`;

describe.skipIf(!url)("graph context", () => {
  let g: Graph;

  beforeAll(async () => {
    g = await graphFor(A);
    await run(g, "MATCH (n) DETACH DELETE n");
    // The checkout story: page 1 said retry on 5xx; page 3 (witnessed)
    // replaces it; page 4 proposes replacing page 3. The retry task depends on
    // page 1, and the baton for it pins page 2. Page 5 is unrelated.
    await run(
      g,
      `CREATE (p1:Note {id: 'p1', page: 1, title: 'Retry checkout on 5xx', hash: 'h1', witnessed: true, deleted: false}),
              (p2:Note {id: 'p2', page: 2, title: 'Payments API is not idempotent', hash: 'h2', witnessed: true, deleted: false}),
              (p3:Note {id: 'p3', page: 3, title: 'No retries until idempotency keys', hash: 'h3', witnessed: true, deleted: false}),
              (p4:Note {id: 'p4', page: 4, title: 'Retry with idempotency keys', hash: 'h4', witnessed: false, source: 'codex', deleted: false}),
              (p5:Note {id: 'p5', page: 5, title: 'Deploy notes', hash: 'h5', witnessed: true, deleted: false}),
              (p3)-[:SUPERSEDES {accepted: true}]->(p1),
              (p4)-[:SUPERSEDES {accepted: false}]->(p3),
              (t:Task {id: 't1', title: 'Add retry to checkout', done: false}),
              (t)-[:DEPENDS_ON]->(p1),
              (h:Handoff {id: 'h1', goal: 'Retry checkout', status: 'OPEN'}),
              (h)-[:FOR]->(t),
              (h)-[:PINS]->(p2),
              (h2:Handoff {id: 'h2', goal: 'Deploy', status: 'OPEN'}),
              (h2)-[:PINS]->(p5)`,
    );
  });

  afterAll(async () => {
    await g?.delete().catch(() => {});
    await (await graphFor(B)).delete().catch(() => {});
  });

  it("delivers the witnessed replacement of a page a task depends on, with the path", async () => {
    const { items } = await contextFor(g, "h1");
    const ids = items.map((i) => i.id).sort();
    expect(ids).toEqual(["p2", "p3"]);
    const p3 = items.find((i) => i.id === "p3")!;
    expect(p3.replaces).toMatchObject({ id: "p1", chain: [1, 3] });
    expect(p3.via.map((s) => s.kind)).toEqual(["Handoff", "Task", "Note"]);
    expect(p3.proposals.map((p) => p.id)).toEqual(["p4"]);
  });

  it("never delivers an unwitnessed proposal as the current page", async () => {
    const { items, truncated } = await contextFor(g, "h1");
    expect(items.some((i) => i.id === "p4")).toBe(false);
    expect(warningsOf(items, truncated).join("\n")).toMatch(/waiting to be witnessed \(page 4/);
  });

  it("leaves unrelated pages out", async () => {
    expect((await contextFor(g, "h2")).items.map((i) => i.id)).toEqual(["p5"]);
  });

  it("follows a three-step chain to its end", async () => {
    await run(
      g,
      `CREATE (a:Note {id: 'c1', page: 11, title: 'v1', hash: 'x', witnessed: true, deleted: false}),
              (b:Note {id: 'c2', page: 12, title: 'v2', hash: 'x', witnessed: true, deleted: false}),
              (c:Note {id: 'c3', page: 13, title: 'v3', hash: 'x', witnessed: true, deleted: false}),
              (b)-[:SUPERSEDES {accepted: true}]->(a), (c)-[:SUPERSEDES {accepted: true}]->(b),
              (:Handoff {id: 'hc', status: 'OPEN'})-[:PINS]->(a)`,
    );
    const [item] = (await contextFor(g, "hc")).items;
    expect(item).toMatchObject({ id: "c3", replaces: { id: "c1", chain: [11, 12, 13] } });
  });

  it("reports two witnessed replacements of one page as a conflict", async () => {
    await run(
      g,
      `CREATE (o:Note {id: 'k0', page: 20, title: 'old', hash: 'x', witnessed: true, deleted: false}),
              (x:Note {id: 'k1', page: 21, title: 'one way', hash: 'x', witnessed: true, deleted: false}),
              (y:Note {id: 'k2', page: 22, title: 'the other', hash: 'x', witnessed: true, deleted: false}),
              (x)-[:SUPERSEDES {accepted: true}]->(o), (y)-[:SUPERSEDES {accepted: true}]->(o),
              (:Handoff {id: 'hk', status: 'OPEN'})-[:PINS]->(o)`,
    );
    const { items, truncated } = await contextFor(g, "hk");
    expect(items).toHaveLength(1);
    expect(items[0].conflicts).toHaveLength(1);
    expect(warningsOf(items, truncated).join("\n")).toMatch(/ask the user which one stands/);
  });

  it("terminates on a replacement loop", async () => {
    await run(
      g,
      `CREATE (a:Note {id: 'l1', page: 30, title: 'a', hash: 'x', witnessed: true, deleted: false}),
              (b:Note {id: 'l2', page: 31, title: 'b', hash: 'x', witnessed: true, deleted: false}),
              (a)-[:SUPERSEDES {accepted: true}]->(b), (b)-[:SUPERSEDES {accepted: true}]->(a),
              (:Handoff {id: 'hl', status: 'OPEN'})-[:PINS]->(a)`,
    );
    expect((await contextFor(g, "hl")).items).toHaveLength(1);
  });

  it("records a receipt, then says what changed since: replaced, edited, added", async () => {
    const before = await contextFor(g, "h1");
    const receipt = await recordReceipt(g, "h1", "claude-code", before);
    const found = await findReceipt(g, "claude-code");
    expect(found?.id).toBe(receipt.id);
    expect(found?.delivered.map((d) => d.id).sort()).toEqual(["p2", "p3"]);

    // The user witnesses page 4; page 2 is edited; the task now also depends on page 5.
    await run(g, "MATCH (p4:Note {id: 'p4'})-[s:SUPERSEDES]->() SET s.accepted = true, p4.witnessed = true");
    await run(g, "MATCH (p2:Note {id: 'p2'}) SET p2.hash = 'h2b'");
    expect(await linkDependency(g, "t1", "p5", "codex", "deploy order")).toBe("linked");

    const now = await contextFor(g, "h1");
    const changes = diff((await findReceipt(g, "claude-code", receipt.id))!.delivered, now.items);
    const kinds = Object.fromEntries(changes.map((c) => [c.kind, c]));
    expect(kinds.replaced).toMatchObject({ was: { id: "p3" }, now: { id: "p4" } });
    expect(kinds.edited).toMatchObject({ was: { id: "p2" } });
    expect(kinds.added).toMatchObject({ now: { id: "p5" } });

    // A refreshed receipt is no longer the agent's current one.
    const fresh = await recordReceipt(g, "h1", "claude-code", now, receipt.id);
    expect((await findReceipt(g, "claude-code"))?.id).toBe(fresh.id);
    expect(diff((await findReceipt(g, "claude-code"))!.delivered, now.items)).toEqual([]);
  });

  it("finds what leans on a page, through the pages it replaced, and who was told", async () => {
    const impact = (await impactOf(g, "p4"))!;
    const kinds = impact.dependents.map((d) => `${d.kind}:${d.id}`);
    expect(kinds).toContain("Task:t1");
    expect(kinds).toContain("Handoff:h1");
    expect(kinds).not.toContain("Handoff:h2");
    const viaTask = impact.dependents.find((d) => d.id === "h1")!;
    expect(viaTask.path.map((s) => s.id)).toEqual(["h1", "t1", "p1"]);
    expect(impact.told.map((t) => t.agent)).toContain("claude-code");
  });

  it("refuses a dependency loop and unknown ends", async () => {
    await run(g, "CREATE (:Note {id: 'd1', page: 40, title: 'x', hash: 'x', witnessed: true, deleted: false}), (:Note {id: 'd2', page: 41, title: 'y', hash: 'x', witnessed: true, deleted: false})");
    expect(await linkDependency(g, "d1", "d2", "codex", null)).toBe("linked");
    expect(await linkDependency(g, "d2", "d1", "codex", null)).toBe("loop");
    expect(await linkDependency(g, "d1", "d1", "codex", null)).toBe("loop");
    expect(await linkDependency(g, "nope", "d1", "codex", null)).toBe("missing-from");
    expect(await linkDependency(g, "d1", "nope", "codex", null)).toBe("missing-to");
  });

  it("keeps each account's graph to itself", async () => {
    const other = await graphFor(B);
    await run(other, "CREATE (:Note {id: 'p1', page: 1, title: 'B owns this', hash: 'b', witnessed: true, deleted: false})");
    const [mine] = await read<{ title: string }>(g, "MATCH (n:Note {id: 'p1'}) RETURN n.title AS title");
    expect(mine.title).toBe("Retry checkout on 5xx");
    expect(await contextFor(other, "h1")).toEqual({ items: [], truncated: false });
  });
});
