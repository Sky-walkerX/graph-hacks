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

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.EMAIL ?? `demo-${Date.now()}@example.com`;
const PASSWORD = process.env.PASSWORD ?? "manifest-demo-1";
const QUIET = process.env.QUIET === "1";

let failures = 0;
const log = (...a) => !QUIET && console.log(...a);
function expect(ok, what) {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// A cookie jar, enough for NextAuth's credentials sign-in.
const jar = new Map();
async function web(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res;
}
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function signUp() {
  const reg = await web("/api/register", json({ email: EMAIL, password: PASSWORD, name: "Demo" }));
  if (!reg.ok) throw new Error(`register: ${reg.status} ${await reg.text()}`);
  const { csrfToken } = await (await web("/api/auth/csrf")).json();
  const form = new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, json: "true" });
  await web("/api/auth/callback/credentials", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error("sign-in didn't set a session");
}

async function token(name) {
  const res = await web("/api/tokens", json({ name }));
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).secret;
}

/** An agent: calls the notebook's MCP tools with its own token. */
function agent(secret) {
  let id = 0;
  return async (name, args = {}) => {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
    });
    const raw = await res.text();
    // Streamable HTTP answers as JSON or as one SSE event.
    const body = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.split("\n").find((l) => l.startsWith("data:")).slice(5));
    if (body.error) throw new Error(`${name}: ${body.error.message}`);
    const text = body.result.content.map((c) => c.text).join("\n");
    return { text, isError: Boolean(body.result.isError) };
  };
}

const idIn = (text, what = "Note id") => text.match(new RegExp(`${what} ([0-9a-f-]{36})`))?.[1];

async function witness(noteId) {
  const res = await web(`/api/milestones/${noteId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ witnessed: true }) });
  if (!res.ok) throw new Error(`witness: ${res.status}`);
}

async function main() {
  console.log(`LockIn Manifest scenario against ${BASE}`);
  await signUp();
  const claude = agent(await token("claude-code"));
  const codex = agent(await token("codex"));

  log("\n1. Claude Code records the retry decision and what it learned about the payments API; the user witnesses both.");
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

  log("\n2. It plans the retry work, says the task rests on the retry decision, and hands off (usage cap).");
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

  log("\n3. Codex picks it up in a fresh session: the graph hands it the retry decision through the task, with a receipt.");
  const pick = await codex("pickup_handoff", { repo: "acme/shop" });
  log(pick.text);
  expect(/Context manifest \(receipt [0-9a-f-]{36}\)/.test(pick.text), "pickup returns a context manifest with a receipt");
  expect(pick.text.includes("Checkout: retry the payment call on 5xx") && /task "Add retry/.test(pick.text), "manifest delivers the decision the task depends on, with the path");

  log("\n4. A second agent racing for the same baton loses cleanly.");
  const late = await claude("pickup_handoff", { repo: "acme/shop" });
  expect(!/Context manifest/.test(late.text), "only one agent takes the baton");

  log("\n5. Claude Code finds the payments API isn't idempotent and proposes replacing the retry decision.");
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

  log("\n6. Before the user witnesses it, Codex's context hasn't changed: a proposal isn't the current page.");
  const early = await codex("check_context", { refresh: false });
  log(early.text);
  expect(/has changed/.test(early.text) && /Your context is current/.test(early.text), "an unwitnessed proposal doesn't change the context");

  log("\n7. The user witnesses the replacement.");
  await witness(replId);

  log("\n8. Codex finishes the old plan and tries to tick the task done: the server refuses, saying what changed.");
  const tick = await codex("update_plan_item", { id: taskId, done: true });
  log(tick.text);
  expect(tick.isError && /REPLACED/.test(tick.text), "ticking done against a changed context is refused with the change");

  log("\n9. Codex takes the new context: the replacement's text and a fresh receipt.");
  const fresh = await codex("check_context", {});
  log(fresh.text);
  expect(/New receipt/.test(fresh.text) && fresh.text.includes("no automatic retries"), "check_context hands over the replacement");

  log("\n10. With the new context in hand, the task can be ticked.");
  const tick2 = await codex("update_plan_item", { id: taskId, done: true });
  log(tick2.text);
  expect(!tick2.isError, "ticking done after refreshing works");

  log("\n11. What leans on the decision now.");
  const imp = await claude("impact_of_change", { note_id: replId });
  log(imp.text);
  expect(/Task "Add retry/.test(imp.text) && /codex: handed p. \d+ .*still current/.test(imp.text), "impact_of_change finds the task through the replaced page, and codex now current");

  console.log(`\nAccount: ${EMAIL} / ${PASSWORD}`);
  console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
