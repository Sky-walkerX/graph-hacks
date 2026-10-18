# Graph load

Agents working one account's graph at once, 20 rounds each, against FalkorDB on a 4-core cloud container (FalkorDB 4.22.1 in Docker, app and database on the same 4 cores).
Each round an agent picks up a baton (walk its context, write a receipt) and checks its context (read the receipt, walk again, diff); every few rounds it also asks what leans on a page, who knows a topic, or which Ask answers are out of date.
The graph: 5,000 notes (one in five replaced, some in chains), 1,000 tasks, 2,000 batons, 2,000 Ask answers, and every receipt the run writes.
Made by `lib/graph/load.test.ts` (LOAD=1). An operation is one MCP tool's graph work: several queries, reads and writes.

| Agents at once | Operations | Operations / s | p50 | p95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 50 | 130 | 6 ms | 16 ms |
| 10 | 500 | 432 | 15 ms | 69 ms |
| 100 | 5,000 | 450 | 157 ms | 615 ms |

The first run of this benchmark managed 25 operations a second, at any concurrency. Two causes, both fixed: every query went down one connection, which the server answers in order (now a pool, `FALKORDB_POOL`, default 8), and three queries written as one long pattern led the planner to scan every note or receipt instead of starting from the indexed id (now stepped out from the index with `WITH`; one went from 20 ms to under 1 ms). At 100 agents the 4 cores, shared by the test and FalkorDB, are the limit.

### 1 agent

| Operation | Count | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| pickup (walk + receipt) | 20 | 6 ms | 16 ms | 16 ms |
| check_context (receipt + walk + diff) | 20 | 6 ms | 9 ms | 9 ms |
| impact_of_change | 4 | 6 ms | 9 ms | 9 ms |
| who_knows (full-text) | 4 | 10 ms | 16 ms | 16 ms |
| stale_answers | 2 | 41 ms | 41 ms | 41 ms |

### 10 agents

| Operation | Count | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| pickup (walk + receipt) | 200 | 16 ms | 69 ms | 100 ms |
| check_context (receipt + walk + diff) | 200 | 13 ms | 66 ms | 89 ms |
| impact_of_change | 40 | 9 ms | 13 ms | 21 ms |
| who_knows (full-text) | 40 | 27 ms | 87 ms | 87 ms |
| stale_answers | 20 | 54 ms | 72 ms | 72 ms |

### 100 agents

| Operation | Count | p50 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| pickup (walk + receipt) | 2000 | 158 ms | 680 ms | 904 ms |
| check_context (receipt + walk + diff) | 2000 | 154 ms | 659 ms | 867 ms |
| impact_of_change | 400 | 89 ms | 209 ms | 300 ms |
| who_knows (full-text) | 400 | 200 ms | 538 ms | 647 ms |
| stale_answers | 200 | 319 ms | 526 ms | 614 ms |
