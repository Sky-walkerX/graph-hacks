// Agents racing for the same work. Each round one agent leaves a baton and
// AGENTS agents call pickup_handoff for it at the same instant: exactly one
// must take it and be handed a context manifest; the rest must be told it's
// gone. Then every agent checks its context at once, to see the graph serve
// concurrent reads while receipts are being written.
//
//   BASE=http://localhost:3000 AGENTS=8 ROUNDS=10 node eval/race.mjs
//
// Numbers are wall-clock times through the whole stack (HTTP, auth, Postgres,
// FalkorDB) on whatever machine runs it; they say nothing about FalkorDB alone.

import { BASE, agent, signUp, token } from "./lib.mjs";

const AGENTS = Number(process.env.AGENTS ?? 8);
const ROUNDS = Number(process.env.ROUNDS ?? 10);

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const timed = async (f) => {
  const t = performance.now();
  const r = await f();
  return { r, ms: performance.now() - t };
};

async function main() {
  console.log(`Race: ${AGENTS} agents x ${ROUNDS} rounds against ${BASE}`);
  await signUp();
  const lead = agent(await token("lead"));
  const agents = [];
  for (let i = 0; i < AGENTS; i++) agents.push({ name: `agent-${i + 1}`, call: agent(await token(`agent-${i + 1}`)) });

  // One decision every baton's task depends on, so each pickup walks the graph.
  const decision = await lead("save_note", { title: "Race: shared decision", body: "Every racer's task depends on this." });
  const decisionId = decision.text.match(/Note id ([0-9a-f-]{36})/)[1];

  const winners = [];
  const pickupMs = [];
  let errors = 0;
  for (let round = 1; round <= ROUNDS; round++) {
    const task = await lead("add_task", { title: `Race round ${round}`, note_id: decisionId });
    const taskId = task.text.match(/([0-9a-f-]{36})/)[1];
    await lead("link_dependency", { task_id: taskId, depends_on: decisionId });
    await lead("save_handoff", { goal: `Round ${round}`, state: "Waiting", next: "Take it", task_id: taskId, repo: `race/round-${round}` });

    const results = await Promise.all(agents.map((a) => timed(() => a.call("pickup_handoff", { repo: `race/round-${round}` }))));
    const won = results.filter(({ r }) => /Context manifest \(receipt/.test(r.text));
    const lost = results.filter(({ r }) => /Another agent took the baton/.test(r.text) || /No baton is open/.test(r.text));
    errors += results.length - won.length - lost.length;
    winners.push(won.length);
    pickupMs.push(...results.map((x) => x.ms));
    process.stdout.write(`round ${round}: ${won.length} winner(s), ${lost.length} told it's taken\n`);
  }

  // Every agent checks its context at the same moment.
  const reads = await timed(() => Promise.all(agents.map((a) => timed(() => a.call("check_context", { refresh: false })))));
  const readMs = reads.r.map((x) => x.ms);
  const readErrors = reads.r.filter(({ r }) => r.isError && !/hold no receipt/.test(r.text)).length;

  const exactlyOne = winners.every((w) => w === 1);
  console.log("\nResults");
  console.log(`- Rounds with exactly one winner: ${winners.filter((w) => w === 1).length}/${ROUNDS}`);
  console.log(`- Unexpected replies: ${errors}`);
  console.log(`- pickup_handoff under contention (${pickupMs.length} calls): p50 ${pct(pickupMs, 50).toFixed(0)} ms, p95 ${pct(pickupMs, 95).toFixed(0)} ms`);
  console.log(`- ${AGENTS} concurrent check_context calls: all done in ${reads.ms.toFixed(0)} ms (p50 ${pct(readMs, 50).toFixed(0)} ms), ${readErrors} errors`);
  console.log(exactlyOne && errors === 0 && readErrors === 0 ? "PASS" : "FAIL");
  process.exit(exactlyOne && errors === 0 && readErrors === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
