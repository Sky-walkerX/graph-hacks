---
title: "Our own hackathon handoff went stale, and the graph caught it"
published: false
tags: falkordb, ai, mcp, graphdatabase
---

_Draft for dev.to. Built for Graph Hacks (WeMakeDevs × FalkorDB)._

At 13:26 on hackathon day, our project was called **LockIn Relay**. An agent picked up the job of writing our README. At 15:10, a sweep of the other entries found three of them already called "Relay", so we renamed ours **LockIn Manifest**.

The agent writing the README didn't know. Nothing told it. That gap is the whole project.

## Handoffs are snapshots, and decisions move

[LockIn](https://github.com/Sky-walkerX/LockIn) is a notebook that coding agents write to over MCP. One of its features is the **baton**. When Claude Code hits a usage cap, or you switch to Codex mid-feature, the agent leaves a short card: goal, state, next step, and pages to read. The next agent picks it up.

A baton is a snapshot of what was true when it was written. Here's the failure we built against:

1. Claude Code decides "retry the payment call on 5xx", plans a task on that decision, and hands off.
2. Codex picks the work up and starts implementing retries.
3. Claude Code finds the payments API isn't idempotent, so a retry can charge a customer twice. It proposes replacing the decision, and you approve it.
4. Codex is still implementing retries, and will happily tick the task done.

Search doesn't help: Codex isn't searching, it's working. A note history doesn't help either. What's missing is a connection between **the pages Codex was handed**, **the task it's working on**, and **the decision that just changed**.

## That connection is a graph walk

We put it in [FalkorDB](https://www.falkordb.com). Postgres stays the authority on notes and tasks. Before every graph operation we project them into one graph per account. What only the graph holds is the new part: **dependencies** (`Task -[:DEPENDS_ON]-> Note`) and **receipts** (`Receipt -[:DELIVERED {hash}]-> Note`).

When an agent picks up a baton, one pattern finds everything it should read, along with the reason each page is there:

```cypher
MATCH p = (h:Handoff {id: $h})-[:PINS|ABOUT|FOR|DEPENDS_ON*1..4]->(n:Note)
WHERE n.deleted = false
RETURN n.id, [x IN nodes(p) | labels(x)[0] + ':' + coalesce(x.title, x.goal)] AS why
```

Each page found is then followed through the replacements you have approved (LockIn calls this *witnessing*), to the page that stands now:

```cypher
MATCH (n:Note {id: $id})
OPTIONAL MATCH p = (n)<-[:SUPERSEDES*1..8 {accepted: true}]-(cur:Note)
WHERE NOT (cur)<-[:SUPERSEDES {accepted: true}]-(:Note)
RETURN cur, [x IN nodes(p) | x.page] AS chain
```

Two details matter. First, `{accepted: true}` sits on the relationship pattern, so an agent's unapproved proposal is never handed over as the truth; it comes back as a warning. Second, `nodes(p)` *is* the explanation: "this baton → task 'Add retry' → p. 9 → replaced by p. 11". The agent and you read the same path.

Then we write down what was handed over: one `Receipt` node, with a `DELIVERED` edge per page carrying the revision hash. Later, `check_context` runs the same walk again and diffs it against the receipt: replaced, edited, newly witnessed, withdrawn, or added.

## Make it structural, not advisory

Telling an agent "please re-check" is a prompt, and prompts get ignored. So we put the check where the work gets recorded: `update_plan_item` **refuses to tick a task done** while the receipt is out of date, and names the change:

```
Not ticked: the context you picked this task up with has changed.
- REPLACED: p. 9 "Checkout: retry the payment call on 5xx" was replaced by p. 11 "Checkout: no
  automatic retries until charges are idempotent", now witnessed. Reached via this baton → task
  "Add retry with backoff to checkout payment" → p. 9.
```

For Claude Code there's also a hook. Before every prompt, the plugin calls `check_context` in quiet mode. It says nothing until something changes, and then it tells Claude before Claude does anything else.

Finished work doesn't escape either. Ticking a task done records `(Task)-[:DONE_WITH]->(Receipt)`. When a decision behind it changes next week, `trace_task` flags that task and shows exactly which revision it was built on.

## We tested it against the original

We ran 12 frozen fixtures through the same MCP calls against the original LockIn and against the new one. The expectations were fixed before either ran.

| | Original | Manifest |
|---|---|---|
| Fixtures | 5/12 | 12/12 |
| 8 agents racing for one baton, 10 rounds | 0/10 rounds with one winner | 10/10 |

The ties are just as informative. Both handle an unchanged page, a deleted page, another account's data, and a note about the same file that nobody said was a dependency. The original loses exactly where the notebook moved on after the baton was written, which is what a snapshot can't see.

The race result surprised us. The original pickup marked a baton taken but never checked whether *its* claim was the one that landed. With two agents we never hit it; with eight, 5 to 8 agents per round were each told they had the same work.

## Things FalkorDB taught us

- **`exists(pattern)` is not a pattern test** (v4.22). In a `RETURN` it came back true for a pattern with no match, which made every dependency look like a loop. `size([(a)-[:R*1..8]->(b) | 1]) > 0` works, and so does `NOT (a)-[:R]->(b)` inside `WHERE`.
- **Property filters on variable-length relationships work**, and they are exactly right for "follow only approved replacements": `[:SUPERSEDES*1..8 {accepted: true}]`.
- **The full-text index** (`db.idx.fulltext.createNodeIndex`) gave us "who knows about payment retries?" with stemming, in one line. `algo.pageRank(NULL, 'DEPENDS_ON')` ranks the decisions the most work leans on: the ones to change most carefully.
- **One graph per account** is just a name. We derive it from the signed-in user, never from what an agent sends, and test that two accounts with the same ids and titles never see each other.

## What it doesn't do

The guard covers LockIn's own operations. It can't stop an agent from editing code it was told is out of date; it can only tell it, and refuse to record the work as done. Dependencies are explicit: an agent or you says a task rests on a decision, and nothing is inferred from text. Receipts hash a page's text; they don't keep old versions of it.

## Try it

The code is at [github.com/Sky-walkerX/graph-hacks](https://github.com/Sky-walkerX/graph-hacks). `docker compose up` gives you Postgres, FalkorDB and the app, and `node eval/scenario.mjs` plays the whole story against it. `node eval/dogfood.mjs` seeds the notebook from this post, including the README handoff that went stale when we renamed the project.

_Built with Claude Code as a pair programmer._
