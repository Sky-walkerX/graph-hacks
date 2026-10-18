---
title: "My own hackathon handoff went stale. So I gave every agent handoff a receipt."
published: false
description: "LockIn Manifest: agent handoffs that know what they rest on, notice when it changes, and refuse to call stale work done. Built on FalkorDB for Graph Hacks."
tags: falkordb, wemakedevs, ai, mcp
cover_image: https://raw.githubusercontent.com/Sky-walkerX/graph-hacks/main/docs/media/blog-cover.png
---

> **TL;DR**
> - **What:** [LockIn](https://github.com/Sky-walkerX/LockIn) is a notebook AI coding agents write to over MCP. They hand work to each other with "batons". **LockIn Manifest** puts that notebook in a [FalkorDB](https://www.falkordb.com) graph.
> - **What changes:** every handoff now knows what it rests on, keeps a receipt of exactly what the next agent was handed, and catches it when any of that changes.
> - **The one idea:** "is this agent still working from the truth?" is a variable-length walk from a baton, through a task, to a decision and its replacements. The path of that walk is the explanation the agent needs.
> - **Results:** against the original LockIn on 12 frozen cases, **5/12 → 12/12**. With 8 agents racing for one baton, **0/10 → 10/10** rounds with exactly one winner. **450 graph operations a second** with 100 agents at once.
> - **Links:** [code](https://github.com/Sky-walkerX/graph-hacks) · [demo video](#demo) · built for [Graph Hacks](https://www.wemakedevs.org/hackathons/falkordb), Tracks 02 and 03.

## The handoff that went stale on me

At 13:26 on hackathon day my project was called **LockIn Relay**. I had an agent start on the README.

At 15:10 I swept the other entries and found three already called "Relay". I renamed mine **LockIn Manifest**.

The agent writing the README had no idea. Nothing told it. It carried on writing "Relay" into a document for a project that no longer had that name.

That's a small, funny miss. Here's the version that isn't funny.

## LockIn in 150 words

[LockIn](https://github.com/Sky-walkerX/LockIn) is a notebook for people who work with AI coding tools:

- Claude Code, Codex and Cursor connect to it over MCP and save what they learn as pages: decisions, API quirks, things that broke.
- An agent's page is a *proposal* until you **witness** it, LockIn's word for "I've read this and it stands". Only you make an agent's claim true.
- When an agent stops mid-task (a usage cap, a `/clear`, or you switching tools), it leaves a **baton**: a short card with the goal, where things stand, what it tried and ruled out, the exact next step, and up to five pages to read first.
- The next agent picks the baton up and carries on.

![The LockIn Manifest film: agents write to one notebook and you witness; Claude Code hands work to Codex; FalkorDB works out what Codex should read and keeps a receipt; the decision changes; Codex is told.](https://raw.githubusercontent.com/Sky-walkerX/graph-hacks/main/docs/media/manifest-film.webp)

It worked well, until the work outlived the baton.

## A baton is a snapshot, and decisions move

Here's the failure, in the checkout example I built everything against:

1. **Claude Code decides** "retry the payment call on any 5xx", and I witness it. It plans a task, *Add retry with backoff to checkout*, on that decision.
2. **It runs out of usage** and leaves a baton.
3. **Codex picks it up** and starts writing the retry wrapper.
4. **Claude Code, in another session, finds** that the payments API isn't idempotent: a retried 5xx can charge a customer twice. It proposes a replacement, *no automatic retries until charges are idempotent*, and I witness it.
5. **Codex is still writing retries.** It will finish them, tick the task done, and nobody will notice until someone gets charged twice.

Search doesn't help here, because Codex isn't searching; it's working. Note history doesn't help either, because Codex never looked at the decision. It came in through the *task*.

What's missing is a connection between three things:
- the pages Codex was handed,
- the task it's working on,
- the decision that just changed underneath both.

## Why this is a graph problem

Write the question out and it's a path:

> baton → task → the decision the task depends on → whatever has replaced that decision since, as witnessed

Each arrow is a different kind of relationship, and the chain has no fixed length. A decision can be replaced twice. A task can depend on a note that depends on another note.

In tables, that's a recursive join per question, and you have to rebuild the path by hand afterwards to explain the answer. In Cypher it's one pattern, and the path comes back as data. **That path is the explanation.** When LockIn tells an agent "you were handed p. 9 through task *Add retry*, and p. 9 was replaced by p. 11", it is printing `nodes(p)`.

That's why I picked a graph rather than adding columns to LockIn's Postgres.

## The graph model

![The graph model: an agent leaves a baton for a task; the task depends on page 9; page 11 supersedes page 9 once witnessed; the baton pins page 10; the agent received a receipt, which delivered page 11, and the task was done with that receipt.](https://raw.githubusercontent.com/Sky-walkerX/graph-hacks/main/docs/media/graph-model.webp)

**One graph per account**, named from the signed-in user and never from anything an agent sends.

**Postgres stays the authority** on notes, tasks, batons, chats and documents. Before every graph operation, whatever changed since a watermark is projected into FalkorDB. Some things live only in the graph:

| Node / relationship | What it holds |
|---|---|
| `(Note)-[:SUPERSEDES {accepted}]->(Note)` | One page replaces another; `accepted` turns true only when you witness the new one |
| `(Task)-[:DEPENDS_ON]->(Note)` | "This work rests on that decision", said by an agent or by you |
| `(Agent)-[:RECEIVED]->(Receipt)-[:DELIVERED {hash, why}]->(Note)` | Exactly what an agent was handed: which revision of which page, and the path that made it relevant |
| `(Task)-[:DONE_WITH]->(Receipt)` | The context a task was finished against |
| `(Handoff)-[:TRIED]->(Attempt)-[:ASSUMED]->(Note)` | What was ruled out, and the decisions it was ruled out under |
| `(Answer)-[:CITES]->(Note)` | Which pages an answer in LockIn's Ask chat was built on |

## Four queries that do the work

**1. What a baton reaches, and why.** This is the start of every pickup:

```cypher
MATCH p = (h:Handoff {id: $h})-[:PINS|ABOUT|FOR|DEPENDS_ON*1..4]->(n:Note)
WHERE n.deleted = false
RETURN n.id AS id,
       [x IN nodes(p) | {kind: labels(x)[0], label: coalesce(x.title, x.goal), page: x.page}] AS via,
       length(p) AS hops
```

- The pattern follows the four relationship types at once: pinned pages, the note the baton is about, its task, and anything they depend on.
- It goes up to four hops, so a task → note → note dependency is found.
- `via` is the human-readable path. When two paths reach the same page, the shorter one explains it.

**2. The page that stands now.** This follows *only* replacements you've witnessed:

```cypher
UNWIND $ids AS id
MATCH (n:Note {id: id})
OPTIONAL MATCH p = (n)<-[:SUPERSEDES*1..8 {accepted: true}]-(cur:Note)
WHERE NOT (cur)<-[:SUPERSEDES {accepted: true}]-(:Note)
RETURN id, collect(DISTINCT {id: cur.id, page: cur.page, chain: [x IN nodes(p) | x.page]}) AS heads
```

- The property filter sits on the variable-length relationship: `[:SUPERSEDES*1..8 {accepted: true}]`.
  - An agent's unwitnessed proposal is never handed over as the truth. It comes back separately, as a warning.
- `WHERE NOT (cur)<-...` keeps only the end of each chain.
- Two heads means two witnessed replacements of the same page. LockIn reports that as a conflict and asks you which one stands, instead of quietly picking one.

**3. The receipt.** It records exactly what was handed over:

```cypher
MATCH (h:Handoff {id: $h})
MERGE (a:Agent {name: $agent})
CREATE (a)-[:RECEIVED]->(r:Receipt {id: $id, at: $at, handoff: $h})-[:FOR]->(h)
WITH r
UNWIND $items AS it
MATCH (n:Note {id: it.id})
CREATE (r)-[:DELIVERED {hash: it.hash, page: it.page, why: it.why}]->(n)
```

`check_context` later runs queries 1 and 2 again for the same baton and diffs the result against the `DELIVERED` edges. Each page comes back as one of: *replaced*, *edited*, *newly witnessed*, *withdrawn*, *no longer linked*, or *added*.

**4. Who knows what.** This is the Track 03 part. It finds a topic with FalkorDB's full-text index, then asks who holds which version:

```cypher
CALL db.idx.fulltext.queryNodes('Note', $q) YIELD node, score
WHERE node.deleted = false
RETURN node.id AS id, score ORDER BY score DESC LIMIT 20
// ...each hit resolved to the page that stands now (query 2), then:
MATCH (n:Note {id: $id})
WITH n
MATCH (n)-[:SUPERSEDES*0..8]->(v:Note)
WITH n, v
MATCH (v)<-[d:DELIVERED]-(r:Receipt)<-[:RECEIVED]-(a:Agent)
RETURN a.name, max(r.at), d.page, v = n AS current
```

The answer reads like: "p. 12 *Retry with an Idempotency-Key* stands. Claude Code wrote it. **Codex was handed p. 11, since replaced: out of date.**"

`algo.pageRank(NULL, 'DEPENDS_ON')` ranks the decisions the most work rests on. Those are the ones to change most carefully, and the ones `impact_of_change` previews before you witness a replacement.

![Who knows what, asked about payment retries: page 12 replaces pages 11 and 9; Claude Code wrote it; Codex was handed page 11, replaced since.](https://raw.githubusercontent.com/Sky-walkerX/graph-hacks/main/docs/media/who-knows.png)

## Making it structural, not advisory

Telling an agent "please re-check your context" is a prompt, and prompts get skipped. So I put the check where the work gets recorded.

**Stale work can't be called done.** `update_plan_item` refuses to tick a task done while the agent's receipt is out of date, and it names the change. This is the real reply a local model got in my demo run:

```text
Not ticked: the context you picked this task up with has changed.
- REPLACED: p. 9 "Checkout: retry the payment call on 5xx" was replaced by
  p. 11 "Checkout: no automatic retries until charges are idempotent", now
  witnessed. Reached via this baton → task "Add retry with backoff to
  checkout payment" → p. 9.
Call check_context to take the new context, check your work against it,
then tick the task again.
```

**The plugin asks before every prompt.** In Claude Code, a `UserPromptSubmit` hook calls `check_context` in quiet mode. It returns nothing while nothing has changed. Once something changes, it tells Claude before Claude does anything else.

**Finished work stays traceable.** Ticking a task done records `(Task)-[:DONE_WITH]->(Receipt)`. When a decision behind the task changes next week, `trace_task` flags it for review and shows the exact revision it was built on.

![The Context manifests panel: Codex's receipt is out of date because page 11 was replaced by page 12; below it, a finished task is flagged for review.](https://raw.githubusercontent.com/Sky-walkerX/graph-hacks/main/docs/media/manifest-panel.png)

## Two kinds of memory I didn't expect to need

Once receipts worked, two other things in LockIn turned out to have the same problem.

**Dead ends go stale too.** A baton's "tried and ruled out" list is *procedural* memory: don't do this, here's why. But "why" usually rests on a decision. In the checkout story, Claude Code ruled out "a background queue that retries failed charges", because the retry decision said to retry inline.

So each ruled-out attempt is now an `Attempt` node:
- `ON` the task,
- `ASSUMED` the pages that stood when it was ruled out. They're linked once, when the baton is saved, so they stay the pages it was ruled out *under*.

The next agent on the task gets the list at pickup. When one of those premises is replaced, `check_context` says so:

```text
"A queue that retries failed charges in the background" (claude-code).
Ruled out while p. 9 "Checkout: retry the payment call on 5xx" stood; it has
since been replaced by p. 11 "Checkout: no automatic retries until charges are
idempotent". This may be worth retrying.
```

A dead end whose reason has gone away is an open road.

**Answers go stale too.** LockIn has an Ask chat where your local model answers from your notebook and cites pages ("[p. 9]"). Those answers now live in the graph as `(Answer)-[:CITES]->(Note)`.

When a cited page is replaced, the answer is stamped in the chat itself:

![An Ask answer citing page 9, stamped Out of date: page 9 was replaced by page 12. Ask again to answer from what stands now.](https://raw.githubusercontent.com/Sky-walkerX/graph-hacks/main/docs/media/ask-out-of-date.png)

Saved links and PDFs went into the graph too, with a full-text index, so "who knows about idempotency?" also finds the Stripe doc you saved.

## What bit me

**`exists(pattern)` isn't a pattern test** (FalkorDB 4.22). In a `RETURN`, `exists((t)-[:DEPENDS_ON*1..8]->(f))` came back true for a pattern with no match. That made every dependency look like a loop.
- What works: `size([(t)-[:DEPENDS_ON*1..8]->(f) | 1]) > 0`, or `NOT (a)-[:R]->(b)` inside a `WHERE`.

**The bundler broke the client.** Next 16's Turbopack bundled the `falkordb` package, and it died with `e.BigInt is not a function`.
- What works: `serverExternalPackages: ["falkordb"]` in `next.config.ts`.

**My own original code had a race.** LockIn's original pickup marked a baton taken, but never checked whether *its* claim was the one that landed.
- With two agents, my frozen test passed.
- With eight agents racing, **every one of 10 rounds handed the same baton to 5 to 8 agents**.
- The fix is a conditional update that only one caller can win, checked before anything is handed over.

**My first load test managed 25 operations a second.** That was true at 1 agent, at 10, and at 100, which is the signature of something serialized. There were two causes:
- **One connection.** A Redis-protocol server answers one connection's commands in order, so every agent waited behind every other. The fix is a small round-robin pool (`FALKORDB_POOL`, default 8). FalkorDB runs reads from different connections in parallel. A write's reply comes after it commits, so a read sent afterwards on any connection sees it.
- **The planner started in the wrong place.** `GRAPH.PROFILE` showed this query scanning every note in the graph, once per id, instead of starting from the indexed id:

  ```cypher
  MATCH (n:Note {id: $id})<-[:SUPERSEDES {accepted: false}]-(p:Note)
  ```

  Stepping out from the index explicitly fixed it, **from 20 ms to 0.7 ms**:

  ```cypher
  MATCH (n:Note {id: $id})
  WITH n
  MATCH (n)<-[s:SUPERSEDES]-(p:Note) WHERE s.accepted = false
  ```

  Two more queries had the same shape. After the fixes: **450 operations a second with 100 agents, and 6 ms p50 for one.**

I'd have shipped the slow version if I hadn't measured. `GRAPH.PROFILE` is the most useful command I learned this week.

## Did it work?

I froze 12 cases before running anything, wrote down what "correct" means for each, and ran them through the same MCP calls against the original LockIn (the commit I imported) and against LockIn Manifest:

| | LockIn (original) | LockIn Manifest |
|---|:---:|:---:|
| Frozen cases ([`eval/baseline.mjs`](https://github.com/Sky-walkerX/graph-hacks/blob/main/eval/baseline.mjs)) | 5 / 12 | **12 / 12** |
| Rounds with exactly one winner, 8 agents racing | 0 / 10 | **10 / 10** |
| End-to-end story, 21 checks ([`eval/scenario.mjs`](https://github.com/Sky-walkerX/graph-hacks/blob/main/eval/scenario.mjs)) | | **21 / 21** |

The ties matter as much as the wins.
- **Both versions handle:** an unchanged page, a deleted page, another account's data with identical page numbers, and a note about the same file that nobody said was a dependency. Relevance isn't dependency, and I didn't want the graph guessing.
- **The original loses exactly where** the notebook moved on after the baton was written: replacements, chains, pending proposals, conflicts, task dependencies, and the "done" guard. That's what a snapshot can't see, by design.
- **What this doesn't measure:** whether an agent writes better code. The fixtures check that the right text was handed over, or the right refusal given.

Graph load, from [`eval/LOAD.md`](https://github.com/Sky-walkerX/graph-hacks/blob/main/eval/LOAD.md):
- The test graph has 5,000 notes, one in five replaced.
- Each round is a pickup and a context check, plus impact, who-knows and stale-answer queries.
- Everything runs on 4 cores shared by the test and FalkorDB, so read it as a floor, not a ceiling.

| Agents at once | Operations / s | p50 | p95 |
|---:|---:|---:|---:|
| 1 | 130 | 6 ms | 16 ms |
| 10 | 432 | 15 ms | 69 ms |
| 100 | 450 | 157 ms | 615 ms |

## Demo

{% embed YOUTUBE_URL %}

Everything in the video is a real run. Two local agents (Qwen2.5-3B, quantized, on a CPU via llama.cpp) call LockIn's MCP tools, each with its own token.

The model's thinking time is sped up; the tool calls and LockIn's replies are not. In the run, Agent B hit the refused "done", called `check_context`, took the new decision, and then finished. Its prompt only said "if LockIn refuses, do what its reply says". It was the refusal that named `check_context`.

## What it doesn't do

- **The guard covers LockIn's own operations.** It can't stop an agent from editing code it was told is out of date. It can tell the agent, and refuse to record the work as done.
- **Dependencies are explicit.** A task rests on a decision because an agent or you said so (`link_dependency`), not because anything was inferred from text.
- **Receipts hash a page's text.** They can tell you a page changed since, but not show you the old version.
- **It isn't proven at organization scale.** The projection syncs from Postgres before every graph operation. 100 agents on a 5,000-note notebook is what I measured, nothing beyond that.

## What I learned

1. **Keep the path.** The most useful thing the graph returns isn't the answer, it's `nodes(p)`. Every message an agent acts on in this project is a printed path. If you're building agent memory on a graph, return the walk, not just the node.
2. **Memory needs a "since".** Storing what's true is half the job. The other half is knowing what each agent was *told*, so you can say what changed for *them*. A receipt is a small node, and it turned "is the memory current?" into "is *your* copy current?", which is the question agents actually need answered.
3. **Put the check where the work lands.** Warnings in prompts are suggestions. A refusal at "done" that names the change is something even a 3B local model followed.
4. **Profile before you trust a pattern.** Cypher lets you write one beautiful pattern. The planner may start it from the wrong end. `WITH` is how you tell it where to start.

## Try it

```sh
git clone https://github.com/Sky-walkerX/graph-hacks && cd graph-hacks
cp .env.example .env            # set AUTH_SECRET: openssl rand -base64 32
docker compose up -d --build    # Postgres, FalkorDB and LockIn on :3000
node eval/scenario.mjs          # the whole checkout story, 21 checks; prints a login
```

Sign in with the printed account and the home page shows Codex out of date, the finished task flagged for review, and the Ask answer stamped. The graph model, every query and the track mapping are in [How it works](https://github.com/Sky-walkerX/graph-hacks/blob/main/docs/how-it-works.md).

*LockIn existed before Graph Hacks and is imported as its own commit. Everything FalkorDB, everything in this post, was built during the event. I built it with Claude Code as a pair programmer, and the demo's agents are local open models. Every number here comes from a script in the repo you can run yourself.*
