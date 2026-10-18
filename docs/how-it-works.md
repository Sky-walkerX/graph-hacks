# How LockIn Manifest works

The README gives the overview. This page has the detail: the graph model, the Cypher queries the product depends on, how each track bullet maps to a feature, the results, and the limits.

- [The graph model](#the-graph-model)
- [The queries](#the-queries)
- [Why a graph](#why-a-graph)
- [How the tracks map](#how-the-tracks-map)
- [Results](#results)
- [What was reused and what is new](#what-was-reused-and-what-is-new)
- [Limits](#limits)

## The graph model

One graph per account (`lockin_<userId>`). Postgres stays the authority on notes, tasks and batons. They are projected into FalkorDB before every graph operation (`lib/graph/project.ts`), from a watermark on `updatedAt`. **Dependencies and receipts live only in the graph.**

<img src="media/graph-model.webp" alt="The graph model: an agent leaves a baton for a task; the task depends on page 9; page 11 supersedes page 9 once witnessed; the baton pins page 10, which is about a file; the agent received a receipt, which delivered page 11, and the task was done with that receipt." width="100%">

| Node | Key properties |
|---|---|
| `Note` | `id`, `page`, `title`, `summary` (first 600 characters, full-text indexed with `title`), `hash` (revision), `witnessed`, `source`, `deleted` (kept so old receipts still resolve) |
| `Handoff` | `id`, `goal`, `status` (OPEN, PICKED_UP, SUPERSEDED), `source`, `pickedUpBy` |
| `Task` | `id`, `title`, `done` |
| `Receipt` | `id`, `at`, `agent`, `handoff`, `warnings` |
| `Attempt` | `id`, `text`, `at`, `source`: one "tried and ruled out" line of a baton, `TRIED` from it, `ON` its task, `ASSUMED` the pages that stood when it was left |
| `Answer` | `id`, `at`, `chat`, `chatTitle`, `question`, `excerpt`: one Ask reply, `CITES` the notes and documents it cites |
| `Doc` | `id`, `page`, `title`, `summary`, `url`: a saved link or PDF, full-text indexed |
| `Agent`, `File`, `Repo`, `Meta` | name / key; `Meta` holds the projection watermarks |

`SUPERSEDES.accepted` is true only once the replacing note is witnessed. An agent can propose retiring a page, but only you retire it.

## The queries

All parameterized, in `lib/graph/`. Traversals are bounded: 4 hops for context, 8 for a replacement chain, 12 pages per manifest.

**What a baton reaches, and why**: the start of every pickup:

```cypher
MATCH p = (h:Handoff {id: $h})-[:PINS|ABOUT|FOR|DEPENDS_ON*1..4]->(n:Note)
WHERE n.deleted = false
RETURN n.id AS id, [x IN nodes(p) | {kind: labels(x)[0], id: x.id, label: coalesce(x.title, x.goal, x.id), page: x.page}] AS via,
       length(p) AS hops
```

**The page that stands now**: follows only witnessed replacements. More than one head is a conflict:

```cypher
UNWIND $ids AS id
MATCH (n:Note {id: id})
OPTIONAL MATCH p = (n)<-[:SUPERSEDES*1..8 {accepted: true}]-(cur:Note)
WHERE NOT (cur)<-[:SUPERSEDES {accepted: true}]-(:Note)
RETURN id, collect(DISTINCT {id: cur.id, page: cur.page, title: cur.title, hash: cur.hash, witnessed: cur.witnessed,
                             chain: [x IN nodes(p) | x.page]}) AS heads
```

**Proposals waiting for a witness** (delivered as warnings):

```cypher
UNWIND $ids AS id
MATCH (n:Note {id: id})
WITH id, n               // step out from the index: as one pattern, the planner scans every note
MATCH (n)<-[s:SUPERSEDES]-(p:Note)
WHERE s.accepted = false AND p.deleted = false
RETURN id, collect({id: p.id, page: p.page, title: p.title, source: p.source}) AS proposals
```

**The receipt**:

```cypher
MATCH (h:Handoff {id: $h})
MERGE (a:Agent {name: $agent})
CREATE (a)-[:RECEIVED]->(r:Receipt {id: $id, at: $at, agent: $agent, handoff: $h, warnings: $warnings})-[:FOR]->(h)
// then, per page:
MATCH (r:Receipt {id: $id}) UNWIND $items AS it MATCH (n:Note {id: it.id})
CREATE (r)-[:DELIVERED {hash: it.hash, witnessed: it.witnessed, page: it.page, title: it.title, why: it.why}]->(n)
```

`check_context` re-runs the first two queries for the receipt's baton and diffs them against `DELIVERED` (`diff()` in the same file).

**What leans on a decision**: through every page it replaced:

```cypher
MATCH (d:Note {id: $id})-[:SUPERSEDES*0..8]->(base:Note)
WITH DISTINCT base
MATCH p = (x)-[:DEPENDS_ON|FOR|PINS|ABOUT*1..4]->(base)
WHERE (x:Task OR x:Handoff OR x:Note) AND x.id <> $id
RETURN labels(x)[0] AS kind, x.id AS id, coalesce(x.title, x.goal) AS label, length(p) AS hops, ...
```

**Who is working from it, and whether that's still true**:

```cypher
MATCH (d:Note {id: $id})-[:SUPERSEDES*0..8]->(base:Note)
WITH DISTINCT base
MATCH (a:Agent)-[:RECEIVED]->(r:Receipt)-[dl:DELIVERED]->(n:Note)-[:DEPENDS_ON*0..4]->(base)
WHERE NOT ()-[:REFRESHES]->(r)
RETURN DISTINCT a.name AS agent, r.id AS receipt, r.at AS at, dl.page AS page,
       size([(n)<-[:SUPERSEDES {accepted: true}]-(:Note) | 1]) > 0 AS stale
```

**Who knows about a topic**: full-text first, then the same resolution, then who holds which version:

```cypher
CALL db.idx.fulltext.queryNodes('Note', $q) YIELD node, score
WHERE node.deleted = false
RETURN node.id AS id, score ORDER BY score DESC LIMIT 20
// resolved to the pages that stand now, then:
UNWIND $ids AS id
MATCH (n:Note {id: id})
WITH id, n
MATCH (n)-[:SUPERSEDES*0..8]->(v:Note)
WITH id, v
MATCH (v)<-[d:DELIVERED]-(r:Receipt)<-[:RECEIVED]-(a:Agent)
WHERE NOT ()-[:REFRESHES]->(r)
RETURN id, a.name AS agent, max(r.at) AS at, d.page AS page, v.id = id AS current
```

**Keystone decisions**: PageRank over dependencies, credited to the page that stands now (`lib/graph/brain.ts`):

```cypher
CALL algo.pageRank(NULL, 'DEPENDS_ON') YIELD node, score
WITH node, score WHERE node:Note AND node.deleted = false
MATCH (node)<-[:DEPENDS_ON]-()
RETURN DISTINCT node.id AS id, score
```

**Finished work and what it rested on**:

```cypher
MATCH (t:Task {id: $task}), (r:Receipt {id: $receipt})
MERGE (t)-[o:DONE_WITH]->(r) SET o.at = $at, o.agent = $agent
// later: every finished task's receipt, diffed against its baton's context now
MATCH (t:Task)-[o:DONE_WITH]->(r:Receipt) WHERE t.done = true
RETURN t, o.agent, o.at, r.id, r.handoff
```

**What was ruled out, and whether it still is** (`attemptsFor`): this baton's attempts and every earlier baton's on the same task, each with the pages it assumed and what replaced them since:

```cypher
MATCH (h:Handoff {id: $h})
OPTIONAL MATCH (h)-[:TRIED]->(own:Attempt)
OPTIONAL MATCH (h)-[:FOR]->(:Task)<-[:ON]-(same:Attempt)
WITH collect(DISTINCT own) + collect(DISTINCT same) AS xs
UNWIND xs AS x
WITH DISTINCT x
OPTIONAL MATCH (x)-[:ASSUMED]->(n:Note)
OPTIONAL MATCH (n)<-[:SUPERSEDES {accepted: true}]-(newer:Note)
RETURN x.id, x.text, x.source, collect(DISTINCT {page: n.page, title: n.title, newPage: newer.page, newTitle: newer.title}) AS premises
```

An attempt is linked to its premises once, when its baton is saved, so they stay the pages it was ruled out under.

**Ask answers built on pages since replaced** (`lib/graph/ask.ts`): started from the replacements, so it never visits every answer:

```cypher
MATCH (a:Answer)-[:CITES]->(n:Note)<-[:SUPERSEDES {accepted: true}]-(:Note)
RETURN DISTINCT a.id, a.question, n.id, n.page ORDER BY a.at DESC LIMIT 200
// plus answers citing deleted pages; each cited page is then resolved to the one that stands now
```

**No dependency loops**:

```cypher
OPTIONAL MATCH (f) WHERE (f:Task OR f:Note) AND f.id = $from
OPTIONAL MATCH (t:Note {id: $to})
RETURN ..., id(f) = id(t) OR size([(t)-[:DEPENDS_ON*1..8]->(f) | 1]) > 0 AS loop
```

## Why a graph

The question at the heart of this, "has anything this agent was handed been replaced since, through the task it's working on?", is a variable-length walk across four kinds of thing: baton → task → decision → replacement chain. The answer has to come with the path, because the path is the explanation the agent and you act on. In tables it's a recursive join per question, and the path has to be rebuilt by hand. Here it's one pattern, and `nodes(p)` *is* the explanation.

Without FalkorDB there's no manifest: pickup still hands over the baton's pinned pages as they were left, and says plainly that replacements and dependencies aren't followed.

## How the tracks map

| Track bullet | Where it is |
|---|---|
| **02** Shared state and handoffs between agents | Batons, graph-resolved context, receipts, `check_context` |
| **02** Memory should persist, update over time | Notes, plus witnessed `SUPERSEDES` chains, followed at every pickup |
| **02** High-concurrency reads and writes | Atomic claims; `eval/race.mjs`: 8 agents × 10 rounds, exactly one winner every round; `lib/graph/load.test.ts`: 100 agents at once, 450 graph operations a second |
| **02** Separate memory per user or tenant | One FalkorDB graph per account, named from the signed-in user, never from agent input; tested |
| **02** Episodic, semantic, procedural memory | Sessions and batons (episodic), witnessed notes and decisions (semantic), and ruled-out attempts (procedural): `Attempt` nodes tied to the decisions they assumed, handed to the next agent on the task and reopened when a premise is replaced |
| **03** Tracing decisions back to their source | Every delivered page carries the path that made it relevant; receipts keep the exact revision |
| **03** Keeping knowledge current as things change | Witnessed replacements change what's delivered; out-of-date receipts are flagged and refused at "done" |
| **03** Who owns what, and who knows what | `who_knows`: full-text over decisions, then `RECORDED` (who wrote it) and `RECEIVED`/`DELIVERED` (who was told which version, and whether it still stands); `keystone_decisions`: PageRank over `DEPENDS_ON` |
| **03** Answers with clear sources | Manifest lines, `trace_task` and the receipt table cite page, path and revision |
| **03** Gets work done | The "done" guard and `trace_task` act on the graph, not just answer from it: stale work is refused or flagged |
| **03** Knowledge from docs, tickets, chats in one graph | Agents' notes, session summaries, batons, Ask answers (`CITES` what they cite) and saved documents (full-text) share one graph; answers citing replaced pages are flagged in the chat and by `stale_answers`. External ticket systems aren't ingested |

## Results

**Against the original LockIn.** We ran the same 12 frozen fixtures through the same MCP calls against the original LockIn (the imported commit) and against LockIn Manifest. The expectations were fixed before either ran. Full table: [`eval/RESULTS.md`](../eval/RESULTS.md).

| | LockIn (original) | LockIn Manifest |
|---|---|---|
| Fixtures passed (`eval/baseline.mjs`) | **5/12** | **12/12** |
| Both pass | F1 unchanged page, F8 same-file note left out, F9 deleted page, F11 other account, F12 two-agent race | |
| Only Manifest passes | | F2 replaced page, F3 three-step chain, F4 pending proposal warned, F5 conflict flagged, F6 task dependency, F7 transitive dependency, F10 "done" refused after a change |
| 8 agents racing for one baton, 10 rounds (`eval/race.mjs`) | **0/10** rounds with one winner: 5–8 agents per round were each told they had it | **10/10** |

The original's pickup is a snapshot of the pinned pages, by design. These fixtures are the cases where the notebook moved on after the baton was left, which is when a snapshot goes wrong.

**The rest**, on one machine. The numbers include HTTP, auth, Postgres and FalkorDB together, so they are not a FalkorDB benchmark:

| Check | Result |
|---|---|
| Scenario (`eval/scenario.mjs`) | 21/21 checks pass |
| Graph tests (`lib/graph/*.test.ts`, real FalkorDB) | 23/23 pass |
| Race, production Docker stack, 8 agents × 10 rounds | one winner every round; pickup p50 89 ms, p95 123 ms |
| Race, production Docker stack, 16 agents × 10 rounds | one winner every round; pickup p50 144 ms, p95 197 ms; 16 concurrent `check_context` in 133 ms |

**The graph alone, under load** ([`eval/LOAD.md`](../eval/LOAD.md), `lib/graph/load.test.ts`): a 5,000-note graph, agents picking up, checking context, asking what leans on a page and who knows a topic, on a 4-core machine shared by the test and FalkorDB:

| Agents at once | Graph operations a second | p50 | p95 |
|---:|---:|---:|---:|
| 1 | 130 | 6 ms | 16 ms |
| 10 | 432 | 15 ms | 69 ms |
| 100 | 450 | 157 ms | 615 ms |

Its first run managed 25 a second at any concurrency: every query went down one connection, and three queries let the planner scan every note. A connection pool and stepping out from the indexed id with `WITH` fixed both.

## What was reused and what is new

LockIn existed before the event. The import is its own commit (`78a20d7`, from `Sky-walkerX/LockIn@1a5924a`), so `git diff 78a20d7` shows everything built during Graph Hacks.

| Before the event (LockIn) | Built during Graph Hacks |
|---|---|
| Notebook, MCP server, agent tokens, batons (`save_handoff` / `pickup_handoff`), witness workflow, `supersede_note`, the Claude Code plugin, Docker Compose | All of `lib/graph/` (FalkorDB client, per-account graphs, projection, context walks, receipts, diff, impact, finished-work tracing, who-knows, keystones, receipt views); `check_context`, `link_dependency`, `impact_of_change`, `trace_task`, `who_knows`, `keystone_decisions`, `stale_answers`; ruled-out attempts as procedural memory; Ask answers and saved documents in the graph, and the *Out of date* stamp in Ask; graph-backed `pickup_handoff`; the "done" guard in `update_plan_item`; impact preview in `supersede_note`; the fix for the unchecked claim in pickup; the Context manifests and Who knows what panels, the receipt graph, `/api/manifest`, `/api/brain`; the plugin's `check_context` hook; FalkorDB in Compose; GCP deploy; `eval/` |

The original LockIn README is at [`docs/lockin.md`](lockin.md). The research and plan behind this entry are in [`LOCKIN_FALKORDB_RESEARCH_AND_PLAN.md`](../LOCKIN_FALKORDB_RESEARCH_AND_PLAN.md).

## Limits

- **The guard covers LockIn's own operations.** Ticking a task done through LockIn is refused while the receipt is out of date. Nothing stops an agent from editing code it was told is out of date; the manifest tells it, it doesn't enforce it.
- **Dependencies are explicit.** A task depends on a decision because an agent or you said so (`link_dependency`), not because anything was inferred from text. Notes about the same file are not treated as dependent.
- **Revisions are hashes of the current text,** not a version history. A receipt can tell you a page changed since, but not show the old text.
- **The projection syncs before every graph operation.** It costs a Postgres query or two per call. The graph itself holds up to 100 agents at once on a 5,000-note notebook; we haven't tested an organization's worth.
- The numbers above come from a dev server on one machine.
