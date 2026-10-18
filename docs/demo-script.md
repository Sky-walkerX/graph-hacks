# Demo video script (about 3 minutes)

Record against the deployed instance, or local `docker compose up`. Before recording:

```sh
BASE=<url> STOP_AFTER=7 node eval/scenario.mjs   # prints a login; Codex's context is now out of date
BASE=<url> node eval/dogfood.mjs                 # optional second account: our own build's decisions
```

Keep two terminals ready, Claude Code and Codex (or two Claude Code sessions with different LockIn tokens), plus the app signed in to the scenario account.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Title card: "LockIn Manifest: a handoff that knows when it went stale" | "Coding agents hand work to each other all the time. A handoff is a snapshot, and decisions keep moving." |
| 0:15–0:40 | Claude Code saves "retry the payment call on 5xx", adds the task, `link_dependency`, `save_handoff` | "Claude Code decides to retry payments, plans a task on that decision, and hands off." |
| 0:40–1:05 | Codex: `pickup_handoff`. Scroll to **Context manifest**: the decision arrives *via task → p. 9*, with a receipt id | "Codex picks it up. FalkorDB walks from the baton through the task to the decision, hands over the page that stands now, and keeps a receipt." |
| 1:05–1:25 | Claude Code: `supersede_note` (not idempotent). Reply: **Once witnessed, this affects… codex: handed p. 9** | "Claude Code finds retries can double-charge, and proposes a replacement. Before anyone approves it, the graph shows what it affects, including which agent is working from the old page." |
| 1:25–1:40 | App: witness page 11. Home: **Context manifests**, Codex **Out of date**; open "Show the graph" | "I approve it. Codex's receipt goes out of date, and here's the graph behind it: exactly what the query returned." |
| 1:40–2:05 | Codex: next prompt; the plugin hook says what changed. Codex tries `update_plan_item done` → **Not ticked: REPLACED…** | "Codex is told before its next prompt, and if it tries to finish the old plan, the server refuses and names the change." |
| 2:05–2:20 | Codex: `check_context` → new receipt and page 11's text; tick → done, recorded against the receipt | "It takes the new context, adjusts, and finishes. The task is recorded against the exact receipt it was done with." |
| 2:20–2:35 | App: Who knows what → "payment retries"; keystones | "For the team: who knows what, and who still holds an old version. And the decisions the most work rests on, ranked with PageRank." |
| 2:35–2:50 | `eval/RESULTS.md` table: original 5/12 vs 12/12; race 0/10 vs 10/10 | "Against the original LockIn on 12 frozen fixtures: 5 to 12. With eight agents racing, the original told up to eight of them they had the same work." |
| 2:50–3:00 | README: graph model + repo link | "FalkorDB is the reason this works: the path is the explanation. Code, queries and setup are in the repo." |

Notes:
- Show real tool calls, not replays. If a step is replayed from a recording, label it on screen.
- Keep the receipt id visible when Codex picks up and again in the app. It's the same receipt, which is the point.
- The dogfood account is the backup story: Codex writing the README for "LockIn Relay" after the rename.
