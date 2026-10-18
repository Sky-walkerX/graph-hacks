// The checkout story, end to end against a running LockIn: two agents, one
// decision that changes under them, and the graph telling the second agent
// what changed before it calls the work done. Makes its own account, so run
// it against a scratch instance.
//
//   node eval/scenario.mjs                       # http://localhost:3000
//   BASE=https://… node eval/scenario.mjs
//
// Prints each step and the server's reply, then checks the replies say what
// they should. Exits 1 when a check fails. Leaves the account in place so the
// story can be opened in the app (the email and password are printed).
// STOP_AFTER=7 stops once the user has witnessed the replacement, leaving
// Codex's context out of date: the state to open the app at for a demo.

import { BASE, EMAIL, PASSWORD, agent, signUp, token, witness } from "./lib.mjs";

const QUIET = process.env.QUIET === "1";
const STOP_AFTER = Number(process.env.STOP_AFTER ?? Infinity);

let failures = 0;
const log = (...a) => !QUIET && console.log(...a);
function done() {
  console.log(`\nAccount: ${EMAIL} / ${PASSWORD}`);
  console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
/** Prints step n, or ends the run when it's past STOP_AFTER. */
function step(n, what) {
  if (n > STOP_AFTER) done();
  log(`\n${n}. ${what}`);
}
function expect(ok, what) {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const idIn = (text, what = "Note id") => text.match(new RegExp(`${what} ([0-9a-f-]{36})`))?.[1];

async function main() {
  console.log(`LockIn Manifest scenario against ${BASE}`);
  await signUp();
  const claude = agent(await token("claude-code"));
  const codex = agent(await token("codex"));

  step(1, "Claude Code records the retry decision and what it learned about the payments API; the user witnesses both.");
  const retry = await claude("save_note", {
    title: "Checkout: retry the payment call on 5xx",
    body: "Decision: `POST /payments/charge` is retried up to 3 times with backoff on any 5xx. Implemented in `lib/checkout/pay.ts`.",
    repo: "acme/shop",
    files: ["lib/checkout/pay.ts"],
  });
  const retryId = idIn(retry.text);
  const api = await claude("save_note", {
    title: "Payments API: charge endpoint",
    body: "`POST /payments/charge` takes `amount`, `currency`, `customer`. Responds 201 with the charge id.",
    repo: "acme/shop",
    files: ["lib/payments/client.ts"],
  });
  const apiId = idIn(api.text);
  await witness(retryId);
  await witness(apiId);

  step(2, "It plans the retry work, says the task rests on the retry decision, and hands off (usage cap).");
  const task = await claude("add_task", { title: "Add retry with backoff to checkout payment", note_id: retryId });
  const taskId = task.text.match(/task ([0-9a-f-]{36})/i)?.[1] ?? task.text.match(/([0-9a-f-]{36})/)?.[1];
  const dep = await claude("link_dependency", { task_id: taskId, depends_on: retryId, reason: "the retry policy is what the task implements" });
  expect(!dep.isError, "link_dependency records task → decision");
  const apiPage = Number(api.text.match(/on page (\d+)/)[1]);
  await claude("save_handoff", {
    goal: "Retry failed checkout payments with backoff",
    state: "Decision recorded; retry wrapper half-written in lib/checkout/pay.ts, no tests yet.",
    next: "Finish the retry wrapper and add a test for 3 retries on 503.",
    next_at: "lib/checkout/pay.ts:40",
    pages: [apiPage],
    task_id: taskId,
    repo: "acme/shop",
  });

  step(3, "Codex picks it up in a fresh session: the graph hands it the retry decision through the task, with a receipt.");
  const pick = await codex("pickup_handoff", { repo: "acme/shop" });
  log(pick.text);
  expect(/Context manifest \(receipt [0-9a-f-]{36}\)/.test(pick.text), "pickup returns a context manifest with a receipt");
  expect(pick.text.includes("Checkout: retry the payment call on 5xx") && /task "Add retry/.test(pick.text), "manifest delivers the decision the task depends on, with the path");

  step(4, "A second agent racing for the same baton loses cleanly.");
  const late = await claude("pickup_handoff", { repo: "acme/shop" });
  expect(!/Context manifest/.test(late.text), "only one agent takes the baton");

  step(5, "Claude Code finds the payments API isn't idempotent and proposes replacing the retry decision.");
  const repl = await claude("supersede_note", {
    id: retryId,
    title: "Checkout: no automatic retries until charges are idempotent",
    body: "`POST /payments/charge` has no idempotency key: a retried 5xx can charge twice (seen in staging, charge ids ch_81 and ch_82). Don't retry automatically. Retry only once the API accepts `Idempotency-Key`; until then surface the error and let the customer retry.",
    repo: "acme/shop",
    files: ["lib/checkout/pay.ts", "lib/payments/client.ts"],
  });
  log(repl.text);
  const replId = idIn(repl.text);
  expect(/Once witnessed, this affects/.test(repl.text) && /codex: handed p. \d+/.test(repl.text), "the proposal previews what it affects, including the agent that was told");

  step(6, "Before the user witnesses it, Codex's context hasn't changed: a proposal isn't the current page.");
  const early = await codex("check_context", { refresh: false });
  log(early.text);
  expect(/has changed/.test(early.text) && /Your context is current/.test(early.text), "an unwitnessed proposal doesn't change the context");

  step(7, "The user witnesses the replacement.");
  await witness(replId);

  step(8, "Codex finishes the old plan and tries to tick the task done: the server refuses, saying what changed.");
  const tick = await codex("update_plan_item", { id: taskId, done: true });
  log(tick.text);
  expect(tick.isError && /REPLACED/.test(tick.text), "ticking done against a changed context is refused with the change");

  step(9, "Codex takes the new context: the replacement's text and a fresh receipt.");
  const fresh = await codex("check_context", {});
  log(fresh.text);
  expect(/New receipt/.test(fresh.text) && fresh.text.includes("no automatic retries"), "check_context hands over the replacement");

  step(10, "With the new context in hand, the task can be ticked.");
  const tick2 = await codex("update_plan_item", { id: taskId, done: true });
  log(tick2.text);
  expect(!tick2.isError, "ticking done after refreshing works");

  step(11, "What leans on the decision now.");
  const imp = await claude("impact_of_change", { note_id: replId });
  log(imp.text);
  expect(/Task "Add retry/.test(imp.text) && /codex: handed p. \d+ .*still current/.test(imp.text), "impact_of_change finds the task through the replaced page, and codex now current");

  expect(/Recorded as done against receipt/.test(tick2.text), "the finished task is recorded against the receipt it was done with");

  step(12, "Later the payments API gains idempotency keys; Claude Code replaces the no-retry decision and the user witnesses it.");
  const again = await claude("supersede_note", {
    id: replId,
    title: "Checkout: retry with an Idempotency-Key",
    body: "The payments API now accepts `Idempotency-Key`. Retry `POST /payments/charge` up to 3 times on 5xx, reusing one key per checkout attempt.",
    repo: "acme/shop",
    files: ["lib/checkout/pay.ts"],
  });
  await witness(idIn(again.text));

  step(13, "The finished task is traced to the context it was finished against, and flagged.");
  const trace = await claude("trace_task", {});
  log(trace.text);
  expect(/Add retry with backoff/.test(trace.text) && /may need another look/.test(trace.text) && /REPLACED/.test(trace.text), "trace_task flags finished work whose context changed after it was done");

  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
