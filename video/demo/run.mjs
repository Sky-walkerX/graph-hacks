// The demo, run for real: two local agents (a small model on llama.cpp)
// working through LockIn's MCP tools, and the app recorded in a browser
// while the user witnesses notes and looks at what changed. Writes the
// browser recording and an event log (every agent thought, tool call and
// reply, and every user action, with its time) for the film to be cut from.
//
//   BASE=http://localhost:3000 LLM_URL=http://127.0.0.1:8088/v1/chat/completions \
//     node video/demo/run.mjs out/demo
//
// Agents are prompted step by step; the tool calls they choose, and LockIn's
// replies, are real.

import { mkdirSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { session } from "../../eval/lib.mjs";
import { agent } from "./agent.mjs";

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = process.argv[2] ?? "out/demo";
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? "playwright";
const CHROME = process.env.CHROME;
mkdirSync(OUT, { recursive: true });

const events = [];
let t0 = Date.now();
const mark = (e) => {
  const ev = { t: Date.now() - t0, ...e };
  events.push(ev);
  const show = e.type === "result" ? `${e.tool} → ${e.text.split("\n")[0].slice(0, 100)}` : e.type === "call" ? `${e.tool}(${JSON.stringify(e.args).slice(0, 120)})` : e.text ?? e.label ?? "";
  console.log(`${String(Math.round(ev.t / 1000)).padStart(4)}s ${e.agent ?? "user"} ${e.type}: ${show}`);
  writeFileSync(join(OUT, "events.json"), JSON.stringify(events, null, 1));
};

const idIn = (t, what = "Note id") => t.match(new RegExp(`${what} ([0-9a-f-]{36})`))?.[1];
const pageIn = (t) => Number(t.match(/on page (\d+)/)?.[1]);
const taskIn = (t) => t.match(/task ([0-9a-f-]{36})/i)?.[1] ?? t.match(/([0-9a-f-]{36})/)?.[1];

async function main() {
  const email = `demo-${Date.now()}@lockin.dev`;
  const password = "manifest-demo-1";
  const s = session(BASE, email, password);
  await s.signUp();
  const A = agent({ name: "agent-a", base: BASE, secret: await s.token("agent-a"), onEvent: mark });
  const B = agent({ name: "agent-b", base: BASE, secret: await s.token("agent-b"), onEvent: mark });

  // The browser: the user, signed in, recorded from here on.
  const { chromium } = await import(PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}) });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  });
  // Headless Chrome draws no pointer; draw one, so the film shows where the user clicks.
  await ctx.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const dot = document.createElement("div");
      dot.style.cssText = "position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(210,69,58,.35);border:2px solid #d2453a;pointer-events:none;transition:transform .12s;left:-50px;top:-50px";
      document.body.appendChild(dot);
      addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
      addEventListener("mousedown", () => { dot.style.transform = "scale(.6)"; }, true);
      addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
    });
  });
  const page = await ctx.newPage();
  t0 = Date.now();
  const user = (label, extra = {}) => mark({ type: "user", label, ...extra });

  async function glide(locator) {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  }
  async function click(locator) {
    await locator.scrollIntoViewIfNeeded();
    await glide(locator);
    await page.waitForTimeout(250);
    await locator.click();
  }
  async function home() {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(800);
  }
  async function show(section) {
    const el = page.locator(`section[aria-label='${section}']`);
    await el.waitFor({ timeout: 30000 });
    await el.evaluate((n) => n.scrollIntoView({ behavior: "smooth", block: "start" }));
    await page.waitForTimeout(1500);
    return el;
  }
  async function witness(noteId, label) {
    await page.goto(`${BASE}/inbox?note=${noteId}`);
    await page.waitForLoadState("load");
    await page.waitForTimeout(1200);
    const btn = page.getByRole("button", { name: /^Witness/ }).first();
    user(`open:${label}`);
    await click(btn);
    await page.waitForTimeout(1600);
    user(`witnessed:${label}`);
  }

  await page.goto(`${BASE}/login`);
  await page.fill("input[type=email]", email);
  await page.fill("input[type=password]", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForTimeout(1000);
  user("signed-in");

  // 1. Agent A records a decision and what it knows about the API.
  mark({ type: "chapter", label: "decide" });
  const [d1] = await A.run(
    'Record the team\'s decision: call save_note with {"title": "Checkout: retry the payment call on 5xx", "body": "Decision: POST /payments/charge is retried up to 3 times with backoff on any 5xx. Implemented in lib/checkout/pay.ts.", "repo": "acme/shop", "files": ["lib/checkout/pay.ts"]}.',
    ["save_note"],
  );
  const [d2] = await A.run(
    'Record what you know about the payments API: call save_note with {"title": "Payments API: charge endpoint", "body": "POST /payments/charge takes amount, currency and customer, and answers 201 with the charge id.", "repo": "acme/shop", "files": ["lib/payments/client.ts"]}.',
    ["save_note"],
  );
  const retryId = idIn(d1.text), apiId = idIn(d2.text), apiPage = pageIn(d2.text);
  await home();
  user("inbox-awaiting");
  await witness(retryId, "retry");
  await witness(apiId, "api");

  // 2. It plans the work, says what the task rests on, and hands off.
  mark({ type: "chapter", label: "handoff" });
  const plan = await A.run(
    `Plan the work, in two steps. First call add_task with {"title": "Add retry with backoff to checkout payment", "note_id": "${retryId}"}. Then call link_dependency with {"task_id": "<the id add_task gives you>", "depends_on": "${retryId}", "reason": "the retry decision is what the task implements"}.`,
    ["add_task", "link_dependency"],
    { finishWith: ["add_task", "link_dependency"] },
  );
  const taskId = taskIn(plan.find((r) => r.tool === "add_task" && !r.isError)?.text ?? "");
  await A.run(
    `You're out of usage, so leave a baton for the next agent: call save_handoff with {"goal": "Retry failed checkout payments with backoff", "state": "Decision recorded; retry wrapper half-written, no tests yet.", "next": "Finish the retry wrapper and add a test for 3 retries on 503.", "next_at": "lib/checkout/pay.ts:40", "pages": [${apiPage}], "task_id": "${taskId}", "repo": "acme/shop"}.`,
    ["save_handoff"],
  );
  await home();
  await show("Batons");
  user("baton-waiting");

  // 3. Agent B picks it up: the graph hands it the decision, with a receipt.
  mark({ type: "chapter", label: "pickup" });
  await B.run('Pick up the work another agent left: call pickup_handoff with {"repo": "acme/shop"}.', ["pickup_handoff"], { maxSteps: 3, params: { pickup_handoff: ["repo"] } });
  await home();
  const man = await show("Context manifests");
  user("manifest-current");
  await click(man.locator("summary", { hasText: "What was handed over" }).first());
  await page.waitForTimeout(2200);
  user("receipt-open");

  // 4. Agent A finds a problem and proposes replacing the decision.
  mark({ type: "chapter", label: "change" });
  const [repl] = await A.run(
    `You found that POST /payments/charge has no idempotency key: a retried 5xx charged a customer twice in staging. Replace the retry decision: call supersede_note with {"id": "${retryId}", "title": "Checkout: no automatic retries until charges are idempotent", "body": "POST /payments/charge has no idempotency key, so a retried 5xx can charge twice (ch_81, ch_82). Don't retry automatically until the API accepts Idempotency-Key.", "repo": "acme/shop", "files": ["lib/checkout/pay.ts"]}.`,
    ["supersede_note"],
  );
  const replId = idIn(repl.text);
  await witness(replId, "replacement");
  await home();
  const man2 = await show("Context manifests");
  user("manifest-stale");
  await click(man2.locator("summary", { hasText: "The graph behind it" }).first());
  await page.waitForSelector(".lk-graph svg");
  await page.waitForTimeout(800);
  await page.locator(".lk-graph").first().evaluate((n) => n.scrollIntoView({ behavior: "smooth", block: "center" }));
  await page.waitForTimeout(3000);
  user("graph-open");

  // 5. Agent B tries to finish the old plan.
  mark({ type: "chapter", label: "refused" });
  await B.run(
    `You have finished task ${taskId}. Mark it done: call update_plan_item with {"id": "${taskId}", "done": true}. If LockIn refuses, do what its reply says, then mark it done again.`,
    ["update_plan_item", "check_context"],
    { maxSteps: 5, finishWith: [], params: { update_plan_item: ["id", "done"], check_context: ["refresh"] } },
  );
  await home();
  await show("Context manifests");
  user("manifest-current-again");

  // 6. Later the API gains idempotency keys; the finished work is flagged.
  mark({ type: "chapter", label: "traced" });
  const [again] = await A.run(
    `Good news: the payments API now accepts an Idempotency-Key header. Call supersede_note with {"id": "${replId}", "title": "Checkout: retry with an Idempotency-Key", "body": "The payments API accepts Idempotency-Key. Retry up to 3 times on 5xx, reusing one key per checkout attempt.", "repo": "acme/shop", "files": ["lib/checkout/pay.ts"]}.`,
    ["supersede_note"],
  );
  await witness(idIn(again.text), "second-replacement");
  await home();
  await show("Context manifests");
  await page.waitForTimeout(1000);
  user("finished-review");

  // 7. Who knows what.
  mark({ type: "chapter", label: "who" });
  await B.run('Find out who knows about payment retries: call who_knows with {"topic": "payment retries"}.', ["who_knows"], { maxSteps: 3, params: { who_knows: ["topic"] } });
  await home();
  const brain = await show("Who knows what");
  user("keystones");
  const input = brain.locator("input");
  await click(input);
  await input.pressSequentially("payment retries", { delay: 70 });
  await click(brain.locator("button[type=submit]"));
  await page.waitForTimeout(2500);
  user("who-knows");
  await page.waitForTimeout(1500);

  mark({ type: "end" });
  const video = page.video();
  await ctx.close();
  await browser.close();
  const path = await video.path();
  renameSync(path, join(OUT, "browser.webm"));
  for (const f of readdirSync(OUT)) if (f.endsWith(".webm") && f !== "browser.webm") renameSync(join(OUT, f), join(OUT, `extra-${f}`));
  writeFileSync(join(OUT, "events.json"), JSON.stringify(events, null, 1));
  console.log(`\nDone. ${email} / ${password}\n${OUT}/browser.webm, ${OUT}/events.json`);
}

main().catch((e) => {
  console.error(e);
  writeFileSync(join(OUT, "events.json"), JSON.stringify(events, null, 1));
  process.exit(1);
});
