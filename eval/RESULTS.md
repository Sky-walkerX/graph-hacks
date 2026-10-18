# Baseline evaluation

Twelve frozen fixtures, run through the same MCP calls against the original LockIn (commit `99e7e3a`, imported before the event) and against LockIn Manifest. The expectations were written before either system ran; see `eval/baseline.mjs`. Run on 2026-10-18 10:06 UTC.

| | Fixture | Correct means | LockIn (original) | LockIn Manifest |
|---|---|---|---|---|
| F1 | Pinned page, unchanged | Hands over the page. | pass | pass |
| F2 | Pinned page replaced, replacement witnessed | Hands over the replacement, not the old page. | fail | pass |
| F3 | Three-step replacement chain | Hands over the last page in the chain only. | fail | pass |
| F4 | Replacement proposed, not yet witnessed | Hands over the page that stands, and warns that a replacement is pending. | fail | pass |
| F5 | Two witnessed replacements of one page | Says the two conflict and asks which stands. | fail | pass |
| F6 | Task depends on a decision that isn't pinned | Hands over the decision, through the task. | fail¹ | pass |
| F7 | Transitive dependency: task → note → note | Hands over both notes. | fail¹ | pass |
| F8 | Note about the same file, with no dependency | Leaves it out (relevance isn't dependency). | pass | pass |
| F9 | Pinned page deleted after the baton was left | Doesn't hand over the deleted page; pickup still works. | pass | pass |
| F10 | Decision replaced after pickup, before the task is ticked done | Refuses to tick the task done, and names the change. | fail¹ | pass |
| F11 | Another account with the same page numbers and titles | Hands over nothing from the other account. | pass | pass |
| F12 | Two agents pick up the same baton at once | Exactly one takes it. | pass | pass |
| | **Total** | | **5/12** | **12/12** |

¹ The original has no `link_dependency`, so that step was skipped and the fixture scored on what the original then handed over.

- Both pass: F1, F8, F9, F11, F12.
- Only LockIn Manifest passes: F2, F3, F4, F5, F6, F7, F10.
- Only the original passes: none.

What these show and don't: each fixture checks one behaviour with markers in the note text, so a pass means the right text was (or wasn't) handed over, or the right refusal was given. They don't measure whether an agent then writes better code. The original's pickup is a snapshot of the pinned pages, by design; these fixtures are the cases where the notebook moved on after the baton was left.

## Racing for one baton

`eval/race.mjs` against each, on the same machine: each round, 8 agents call `pickup_handoff` for the same baton at the same moment, for 10 rounds.

| | LockIn (original) | LockIn Manifest |
|---|---|---|
| Rounds where exactly one agent took the baton | **0/10** (5–8 agents per round were each told they had it) | **10/10** (the other 7 were told it was taken) |

F12 above passed on the original with two agents. It took eight to hit the window: the original marked the baton taken but never checked whether its own claim was the one that landed.
