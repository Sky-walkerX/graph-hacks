import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Graph } from "falkordb";
import { graphFor, read, run } from "./client";
import { projectAnswers } from "./ask";

const db = vi.hoisted(() => ({ answers: vi.fn(), question: vi.fn(), conversations: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {
  chatMessage: { findMany: db.answers, findFirst: db.question },
  conversation: { findMany: db.conversations },
} }));

type Answer = { id: string; createdAt: Date; content: string; refs: []; model: null; conversationId: string; conversation: { title: string } };
type Filter = { OR?: Filter[]; createdAt?: Date | { gt?: Date; gte?: Date }; id?: string | { gt?: string; in?: string[] } };

// Mimic Postgres filtering while exercising the real projection and Cypher.
function matches(a: Answer, where: Filter): boolean {
  if (where.OR && !where.OR.some((w) => matches(a, w))) return false;
  if (where.createdAt instanceof Date && a.createdAt.getTime() !== where.createdAt.getTime()) return false;
  if (where.createdAt && !(where.createdAt instanceof Date)) {
    if (where.createdAt.gt && a.createdAt <= where.createdAt.gt) return false;
    if (where.createdAt.gte && a.createdAt < where.createdAt.gte) return false;
  }
  if (typeof where.id === "string" && a.id !== where.id) return false;
  if (where.id && typeof where.id !== "string") {
    if (where.id.gt && a.id <= where.id.gt) return false;
    if (where.id.in && !where.id.in.includes(a.id)) return false;
  }
  return true;
}

const answer = (id: string): Answer => ({ id, createdAt: new Date(1000), content: "A saved answer", refs: [], model: null, conversationId: "chat", conversation: { title: "Chat" } });

describe.skipIf(!process.env.FALKORDB_URL)("Ask projection lifecycle", () => {
  let graph: Graph;
  let messages: Answer[];
  let liveChats: string[];

  beforeAll(async () => { graph = await graphFor(`test-ask-projection-${process.pid}`); });
  afterAll(async () => { await graph?.delete().catch(() => {}); });
  beforeEach(async () => {
    await run(graph, "MATCH (n) DETACH DELETE n");
    messages = [];
    liveChats = ["chat"];
    db.answers.mockImplementation(async ({ where, take }: { where: Filter; take?: number }) =>
      messages.filter((a) => matches(a, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, take));
    db.question.mockResolvedValue({ content: "A question" });
    db.conversations.mockImplementation(async () => liveChats.map((id) => ({ id })));
  });

  it("does not lose answers sharing the timestamp at a batch boundary", async () => {
    messages = Array.from({ length: 501 }, (_, i) => answer(`answer-${String(i).padStart(4, "0")}`));
    await projectAnswers(graph, "user", false);
    await projectAnswers(graph, "user", false);
    const [count] = await read<{ n: number }>(graph, "MATCH (a:Answer) RETURN count(a) AS n");
    expect(count.n).toBe(501);
  });

  it("removes answers from deleted conversations even with no new messages", async () => {
    messages = [answer("deleted-answer")];
    await projectAnswers(graph, "user", false);
    messages = [];
    liveChats = [];
    await projectAnswers(graph, "user", false);
    const [count] = await read<{ n: number }>(graph, "MATCH (a:Answer) RETURN count(a) AS n");
    expect(count.n).toBe(0);
  });
});
