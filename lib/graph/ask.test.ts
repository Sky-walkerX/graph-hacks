import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Graph } from "falkordb";
import { graphFor, run } from "./client";
import { docsAbout, staleAnswers } from "./ask";
import { anyWord, whoKnows } from "./brain";
import { impactOf } from "./context";
import { formatStaleAnswers } from "./format";

// Ask's answers and saved documents against a real FalkorDB (FALKORDB_URL).

const url = process.env.FALKORDB_URL;
const A = `test-ask-${process.pid}`;

describe.skipIf(!url)("answers and documents", () => {
  let g: Graph;

  beforeAll(async () => {
    g = await graphFor(A);
    await run(g, "MATCH (n) DETACH DELETE n");
    // Page 1 (retry on 5xx) is replaced, witnessed, by page 3. One answer
    // cited page 1, another cites page 3, a third cites page 5, since deleted.
    // Page 7 is a saved document on payments.
    await run(
      g,
      `CREATE (p1:Note {id: 'p1', page: 1, title: 'Retry checkout on 5xx', summary: 'retry payments', hash: 'h1', witnessed: true, deleted: false}),
              (p3:Note {id: 'p3', page: 3, title: 'No retries until idempotency keys', summary: 'payments retry idempotency', hash: 'h3', witnessed: true, deleted: false}),
              (p5:Note {id: 'p5', page: 5, title: 'Old deploy notes', hash: 'h5', witnessed: true, deleted: true}),
              (p3)-[:SUPERSEDES {accepted: true}]->(p1),
              (d7:Doc {id: 'd7', page: 7, title: 'Stripe idempotent requests', summary: 'Idempotency keys for payments retries', url: 'https://stripe.com/docs/api/idempotent_requests', type: 'LINK', subjectId: 's', deleted: false}),
              (a1:Answer {id: 'a1', at: 1, chat: 'c1', chatTitle: 'Retries', question: 'Should checkout retry?', excerpt: 'Yes, retry on 5xx [p. 1]'}),
              (a2:Answer {id: 'a2', at: 2, chat: 'c2', chatTitle: 'Retries again', question: 'Can we retry now?', excerpt: 'Not yet [p. 3] [p. 7]'}),
              (a3:Answer {id: 'a3', at: 3, chat: 'c3', chatTitle: 'Deploys', question: 'How do we deploy?', excerpt: 'See [p. 5]'}),
              (a1)-[:CITES {page: 1}]->(p1), (a2)-[:CITES {page: 3}]->(p3), (a2)-[:CITES {page: 7}]->(d7), (a3)-[:CITES {page: 5}]->(p5)`,
    );
  });

  afterAll(async () => {
    await g?.delete().catch(() => {});
  });

  it("flags answers citing a replaced or deleted page, with what stands now", async () => {
    const found = await staleAnswers(g);
    expect(found.map((a) => a.id).sort()).toEqual(["a1", "a3"]);
    const a1 = found.find((a) => a.id === "a1")!;
    expect(a1.cited).toEqual([{ id: "p1", page: 1, title: "Retry checkout on 5xx", now: { id: "p3", page: 3, title: "No retries until idempotency keys" } }]);
    expect(found.find((a) => a.id === "a3")!.cited[0].now).toBeNull();
    expect(formatStaleAnswers(found)).toMatch(/"Should checkout retry\?" .*p\. 1 "Retry checkout on 5xx" was replaced by p\. 3/);
  });

  it("narrows to one note, through what it replaced", async () => {
    expect((await staleAnswers(g, { noteId: "p3" })).map((a) => a.id)).toEqual(["a1"]);
  });

  it("counts answers among what leans on a note", async () => {
    const impact = await impactOf(g, "p3");
    expect(impact!.answers.map((a) => a.id).sort()).toEqual(["a1", "a2"]);
  });

  it("says which answers cite the current page and which an old one", async () => {
    const [k] = await whoKnows(g, { topic: "idempotency" });
    expect(k.note.id).toBe("p3");
    expect(k.answers).toEqual({ current: 1, stale: 1 });
  });

  it("finds saved documents by what they say, with the answers citing them", async () => {
    const docs = await docsAbout(g, anyWord("idempotency keys"));
    expect(docs).toMatchObject([{ id: "d7", page: 7, citedBy: 1 }]);
  });
});
