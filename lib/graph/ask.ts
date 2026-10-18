import type { Graph } from "falkordb";
import prisma from "@/lib/prisma";
import { citedPages } from "@/lib/chat/citations";
import type { MessageRef } from "@/lib/chat/refs";
import { read, run } from "./client";
import { CHAIN, resolve } from "./context";

// Ask's answers and the saved documents, in the graph beside the notes.
//
// An answer cites pages ("[p. 12]"); each cited note or document becomes a
// CITES edge, so when a note is replaced the graph can say which answers
// were built on the old version. Answers never change once written, so each
// is projected once. Documents (saved links and PDFs) become Doc nodes with a
// summary for full-text search, so "who knows about X" finds them too.

/** How much of a document or an answer its node keeps. */
const SUMMARY = 600;
const EXCERPT = 240;
/** Answers projected per sync, oldest first, so a backlog catches up over a few. */
const ANSWERS = 500;

const squash = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

async function watermark(graph: Graph, key: string, full: boolean): Promise<Date | null> {
  if (full) return null;
  const [m] = await read<{ at: number | null }>(graph, "MATCH (m:Meta {key: $key}) RETURN m.at AS at", { key });
  return m?.at ? new Date(m.at) : null;
}

const mark = (graph: Graph, key: string, at: number) => run(graph, "MERGE (m:Meta {key: $key}) SET m.at = $at", { key, at });

/** Saved documents changed since the last sync, and documents since removed. */
export async function projectDocs(graph: Graph, userId: string, full: boolean) {
  const since = await watermark(graph, "docs", full);
  const startedAt = Date.now();
  const docs = await prisma.resource.findMany({
    where: { userId, ...(since ? { updatedAt: { gte: new Date(since.getTime() - 5_000) } } : {}) },
    select: { id: true, page: true, title: true, note: true, extracted: true, url: true, type: true, subjectId: true, updatedAt: true },
  });
  if (docs.length > 0) {
    await run(
      graph,
      `UNWIND $docs AS d
       MERGE (x:Doc {id: d.id})
       SET x.page = d.page, x.title = d.title, x.summary = d.summary, x.url = d.url, x.type = d.type, x.subjectId = d.subjectId, x.deleted = false`,
      {
        docs: docs.map((d) => ({
          id: d.id, page: d.page, title: d.title, url: d.url, type: d.type, subjectId: d.subjectId,
          summary: squash(`${d.note ?? ""} ${d.extracted ?? ""}`, SUMMARY),
        })),
      },
    );
  }
  const [{ live } = { live: 0 }] = await read<{ live: number }>(graph, "MATCH (x:Doc) WHERE x.deleted = false RETURN count(x) AS live");
  if (live !== (await prisma.resource.count({ where: { userId } }))) {
    const ids = (await prisma.resource.findMany({ where: { userId }, select: { id: true } })).map((r) => r.id);
    await run(graph, "MATCH (x:Doc) WHERE x.deleted = false AND NOT x.id IN $ids SET x.deleted = true", { ids });
  }
  const latest = docs.reduce((m, d) => Math.max(m, d.updatedAt.getTime()), since?.getTime() ?? 0);
  await mark(graph, "docs", Math.min(latest, startedAt));
}

/** Ask's answers written since the last sync, each with the pages it cites. */
export async function projectAnswers(graph: Graph, userId: string, full: boolean) {
  const since = await watermark(graph, "answers", full);
  const answers = await prisma.chatMessage.findMany({
    where: { role: "ASSISTANT", conversation: { userId }, ...(since ? { createdAt: { gt: since } } : {}) },
    orderBy: { createdAt: "asc" },
    take: ANSWERS,
    select: { id: true, content: true, refs: true, model: true, createdAt: true, conversationId: true, conversation: { select: { title: true } } },
  });
  if (answers.length === 0) return;
  // The question each answers: the user's turn just before it.
  const questions = await Promise.all(
    answers.map((a) =>
      prisma.chatMessage.findFirst({
        where: { conversationId: a.conversationId, role: "USER", createdAt: { lte: a.createdAt } },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      }),
    ),
  );
  const rows = answers.map((a, i) => {
    const refs = (Array.isArray(a.refs) ? a.refs : []) as MessageRef[];
    const cited = new Set(citedPages(a.content));
    const cites = refs.filter((r) => cited.has(r.page));
    return {
      id: a.id,
      at: a.createdAt.getTime(),
      chat: a.conversationId,
      chatTitle: a.conversation.title,
      model: a.model,
      question: questions[i] ? squash(questions[i]!.content, EXCERPT) : null,
      excerpt: squash(a.content, EXCERPT),
      notes: cites.filter((r) => r.kind === "note").map((r) => ({ id: r.id, page: r.page })),
      docs: cites.filter((r) => r.kind === "resource").map((r) => ({ id: r.id, page: r.page })),
    };
  });
  await run(
    graph,
    `UNWIND $rows AS r
     MERGE (a:Answer {id: r.id})
     SET a.at = r.at, a.chat = r.chat, a.chatTitle = r.chatTitle, a.model = r.model, a.question = r.question, a.excerpt = r.excerpt
     WITH a, r
     UNWIND r.notes AS c
     MATCH (n:Note {id: c.id})
     MERGE (a)-[e:CITES]->(n)
     SET e.page = c.page, e.hash = n.hash`,
    { rows },
  );
  await run(
    graph,
    `UNWIND $rows AS r
     MATCH (a:Answer {id: r.id})
     UNWIND r.docs AS c
     MATCH (d:Doc {id: c.id})
     MERGE (a)-[e:CITES]->(d)
     SET e.page = c.page`,
    { rows },
  );
  await mark(graph, "answers", answers[answers.length - 1].createdAt.getTime());
}

export type StaleAnswer = {
  id: string;
  at: number;
  chat: string;
  chatTitle: string;
  question: string | null;
  excerpt: string;
  /** The cited page, and what stands for it now (null when it was deleted). */
  cited: { id: string; page: number | null; title: string; now: { id: string; page: number | null; title: string } | null }[];
};

/**
 * Answers that cite a page the notebook has moved past: replaced by a
 * witnessed note since, or deleted. Asking again gets an answer from what
 * stands now. With `noteId`, only answers citing that note or anything it
 * replaced; with `chat`, only that conversation's.
 */
export async function staleAnswers(graph: Graph, opts: { noteId?: string; chat?: string; limit?: number } = {}): Promise<StaleAnswer[]> {
  const rows = await read<{ id: string; at: number; chat: string; chatTitle: string; question: string | null; excerpt: string; cid: string; page: number | null; title: string; deleted: boolean }>(
    graph,
    `${opts.noteId ? `MATCH (:Note {id: $note})-[:SUPERSEDES*0..${CHAIN}]->(n:Note) WITH DISTINCT n MATCH (a:Answer)-[:CITES]->(n)` : "MATCH (a:Answer)-[:CITES]->(n:Note)"}
     WITH a, n, size([(n)<-[:SUPERSEDES {accepted: true}]-(:Note) | 1]) AS replaced
     WHERE (n.deleted = true OR replaced > 0)${opts.chat ? " AND a.chat = $chat" : ""}
     RETURN a.id AS id, a.at AS at, a.chat AS chat, a.chatTitle AS chatTitle, a.question AS question, a.excerpt AS excerpt,
            n.id AS cid, n.page AS page, n.title AS title, n.deleted AS deleted
     ORDER BY at DESC LIMIT 200`,
    { note: opts.noteId, chat: opts.chat },
  );
  const heads = await resolve(graph, [...new Set(rows.map((r) => r.cid))]);
  const byAnswer = new Map<string, StaleAnswer>();
  for (const r of rows) {
    const answer = byAnswer.get(r.id) ?? { id: r.id, at: r.at, chat: r.chat, chatTitle: r.chatTitle, question: r.question, excerpt: r.excerpt, cited: [] };
    const head = heads.get(r.cid)?.heads.find((h) => h.id && h.id !== r.cid);
    answer.cited.push({
      id: r.cid, page: r.page, title: r.title,
      now: !r.deleted && head ? { id: head.id!, page: head.page ?? null, title: head.title ?? "" } : null,
    });
    byAnswer.set(r.id, answer);
  }
  return [...byAnswer.values()].slice(0, opts.limit ?? 20);
}

export type FoundDoc = { id: string; page: number | null; title: string; url: string; type: string; subjectId: string; citedBy: number };

/** Saved documents about a topic, from their titles and text, with how many answers cite each. */
export async function docsAbout(graph: Graph, words: string): Promise<FoundDoc[]> {
  if (!words) return [];
  return read<FoundDoc>(
    graph,
    `CALL db.idx.fulltext.queryNodes('Doc', $q) YIELD node, score
     WHERE node.deleted = false
     RETURN node.id AS id, node.page AS page, node.title AS title, node.url AS url, node.type AS type, node.subjectId AS subjectId,
            size([(node)<-[:CITES]-(:Answer) | 1]) AS citedBy, score
     ORDER BY score DESC LIMIT 5`,
    { q: words },
  );
}
