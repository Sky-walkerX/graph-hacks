// The same twelve frozen fixtures, run against the original LockIn (the
// imported commit, 78a20d7) and against LockIn Manifest, through the same MCP
// calls. Each fixture sets up notes and a baton as an agent and the user
// would, has another agent pick the baton up, and checks what it was handed
// against what it should have been handed. Steps that need a tool the
// original doesn't have are skipped there, and the fixture is scored on what
// the original then hands over.
//
//   BASELINE=http://localhost:3006 MANIFEST=http://localhost:3005 node eval/baseline.mjs
//
// Writes eval/RESULTS.md. Every fixture's expectation is fixed below, before
// either system runs; ties and losses are reported as they come out.

import { writeFileSync } from "node:fs";
import { session } from "./lib.mjs";

const TARGETS = [
  ["LockIn (original)", process.env.BASELINE ?? "http://localhost:3006"],
  ["LockIn Manifest", process.env.MANIFEST ?? "http://localhost:3005"],
];

const pageIn = (t) => Number(t.match(/on page (\d+)/)?.[1]);
const idIn = (t) => t.match(/Note id ([0-9a-f-]{36})/)?.[1];
const taskIn = (t) => t.match(/([0-9a-f-]{36})/)?.[1];
const has = (t, mark) => t.includes(mark);

/**
 * Each fixture: what it tests, what correct looks like, a setup that returns
 * what the receiving agent was handed, and a check on that.
 */
const FIXTURES = [
  {
    id: "F1",
    name: "Pinned page, unchanged",
    expect: "Hands over the page.",
    async run({ a, repo }) {
      const n = await a.claude("save_note", { title: "F1 config", body: "[F1-A] use port 8080" });
      await a.witness(idIn(n.text));
      await a.claude("save_handoff", { goal: "F1", state: "s", next: "n", pages: [pageIn(n.text)], repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F1-A]"),
  },
  {
    id: "F2",
    name: "Pinned page replaced, replacement witnessed",
    expect: "Hands over the replacement, not the old page.",
    async run({ a, repo }) {
      const old = await a.claude("save_note", { title: "F2 retry", body: "[F2-OLD] retry 3 times" });
      await a.witness(idIn(old.text));
      const neu = await a.claude("supersede_note", { id: idIn(old.text), title: "F2 retry v2", body: "[F2-NEW] never retry" });
      await a.witness(idIn(neu.text));
      await a.claude("save_handoff", { goal: "F2", state: "s", next: "n", pages: [pageIn(old.text)], repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F2-NEW]") && !has(t, "[F2-OLD]"),
  },
  {
    id: "F3",
    name: "Three-step replacement chain",
    expect: "Hands over the last page in the chain only.",
    async run({ a, repo }) {
      const v1 = await a.claude("save_note", { title: "F3 v1", body: "[F3-V1]" });
      await a.witness(idIn(v1.text));
      const v2 = await a.claude("supersede_note", { id: idIn(v1.text), title: "F3 v2", body: "[F3-V2]" });
      await a.witness(idIn(v2.text));
      const v3 = await a.claude("supersede_note", { id: idIn(v2.text), title: "F3 v3", body: "[F3-V3]" });
      await a.witness(idIn(v3.text));
      await a.claude("save_handoff", { goal: "F3", state: "s", next: "n", pages: [pageIn(v1.text)], repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F3-V3]") && !has(t, "[F3-V1]") && !has(t, "[F3-V2]"),
  },
  {
    id: "F4",
    name: "Replacement proposed, not yet witnessed",
    expect: "Hands over the page that stands, and warns that a replacement is pending.",
    async run({ a, repo }) {
      const cur = await a.claude("save_note", { title: "F4 policy", body: "[F4-CUR]" });
      await a.witness(idIn(cur.text));
      await a.claude("supersede_note", { id: idIn(cur.text), title: "F4 policy v2", body: "[F4-PROPOSED]" });
      await a.claude("save_handoff", { goal: "F4", state: "s", next: "n", pages: [pageIn(cur.text)], repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F4-CUR]") && !has(t, "[F4-PROPOSED]") && /waiting to be witnessed/.test(t),
  },
  {
    id: "F5",
    name: "Two witnessed replacements of one page",
    expect: "Says the two conflict and asks which stands.",
    async run({ a, repo }) {
      const o = await a.claude("save_note", { title: "F5 cache", body: "[F5-OLD]" });
      await a.witness(idIn(o.text));
      const x = await a.claude("supersede_note", { id: idIn(o.text), title: "F5 cache: redis", body: "[F5-X]" });
      const y = await a.claude("supersede_note", { id: idIn(o.text), title: "F5 cache: memory", body: "[F5-Y]" });
      await a.witness(idIn(x.text));
      await a.witness(idIn(y.text));
      await a.claude("save_handoff", { goal: "F5", state: "s", next: "n", pages: [pageIn(o.text)], repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => /ask the user which one stands/.test(t) && !has(t, "[F5-OLD]"),
  },
  {
    id: "F6",
    name: "Task depends on a decision that isn't pinned",
    expect: "Hands over the decision, through the task.",
    async run({ a, repo, skip }) {
      const d = await a.claude("save_note", { title: "F6 decision", body: "[F6-D] amounts are integer cents" });
      await a.witness(idIn(d.text));
      const task = await a.claude("add_task", { title: "F6 task", note_id: idIn(d.text) });
      await skip(a.claude("link_dependency", { task_id: taskIn(task.text), depends_on: idIn(d.text) }));
      await a.claude("save_handoff", { goal: "F6", state: "s", next: "n", task_id: taskIn(task.text), repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F6-D]"),
  },
  {
    id: "F7",
    name: "Transitive dependency: task → note → note",
    expect: "Hands over both notes.",
    async run({ a, repo, skip }) {
      const b = await a.claude("save_note", { title: "F7 base", body: "[F7-B] tax is computed server-side" });
      const n = await a.claude("save_note", { title: "F7 mid", body: "[F7-A] totals come from the tax service" });
      await a.witness(idIn(b.text));
      await a.witness(idIn(n.text));
      const task = await a.claude("add_task", { title: "F7 task", note_id: idIn(n.text) });
      await skip(a.claude("link_dependency", { task_id: taskIn(task.text), depends_on: idIn(n.text) }));
      await skip(a.claude("link_dependency", { note_id: idIn(n.text), depends_on: idIn(b.text) }));
      await a.claude("save_handoff", { goal: "F7", state: "s", next: "n", task_id: taskIn(task.text), repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F7-A]") && has(t, "[F7-B]"),
  },
  {
    id: "F8",
    name: "Note about the same file, with no dependency",
    expect: "Leaves it out (relevance isn't dependency).",
    async run({ a, repo }) {
      const p = await a.claude("save_note", { title: "F8 pinned", body: "[F8-A]", repo: "acme/x", files: ["src/pay.ts"] });
      const other = await a.claude("save_note", { title: "F8 unrelated", body: "[F8-N]", repo: "acme/x", files: ["src/pay.ts"] });
      await a.witness(idIn(p.text));
      await a.witness(idIn(other.text));
      await a.claude("save_handoff", { goal: "F8", state: "s", next: "n", pages: [pageIn(p.text)], repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F8-A]") && !has(t, "[F8-N]"),
  },
  {
    id: "F9",
    name: "Pinned page deleted after the baton was left",
    expect: "Doesn't hand over the deleted page; pickup still works.",
    async run({ a, repo }) {
      const p = await a.claude("save_note", { title: "F9 gone", body: "[F9-A]" });
      await a.witness(idIn(p.text));
      await a.claude("save_handoff", { goal: "F9", state: "s", next: "n", pages: [pageIn(p.text)], repo });
      await a.remove(idIn(p.text));
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => !has(t, "[F9-A]") && /Baton from/.test(t),
  },
  {
    id: "F10",
    name: "Decision replaced after pickup, before the task is ticked done",
    expect: "Refuses to tick the task done, and names the change.",
    async run({ a, repo, skip }) {
      const d = await a.claude("save_note", { title: "F10 rule", body: "[F10-D] retry on 5xx" });
      await a.witness(idIn(d.text));
      const task = await a.claude("add_task", { title: "F10 task", note_id: idIn(d.text) });
      await skip(a.claude("link_dependency", { task_id: taskIn(task.text), depends_on: idIn(d.text) }));
      await a.claude("save_handoff", { goal: "F10", state: "s", next: "n", pages: [pageIn(d.text)], task_id: taskIn(task.text), repo });
      await a.codex("pickup_handoff", { repo });
      const neu = await a.claude("supersede_note", { id: idIn(d.text), title: "F10 rule v2", body: "[F10-E] never retry" });
      await a.witness(idIn(neu.text));
      const tick = await a.codex("update_plan_item", { id: taskIn(task.text), done: true });
      return `${tick.isError ? "REFUSED" : "TICKED"}\n${tick.text}`;
    },
    ok: (t) => t.startsWith("REFUSED") && /REPLACED/.test(t),
  },
  {
    id: "F11",
    name: "Another account with the same page numbers and titles",
    expect: "Hands over nothing from the other account.",
    async run({ a, other, repo }) {
      await other.claude("save_note", { title: "F11 secret", body: "[F11-OTHER]" });
      const mine = await a.claude("save_note", { title: "F11 secret", body: "[F11-MINE]" });
      await a.witness(idIn(mine.text));
      await a.claude("save_handoff", { goal: "F11", state: "s", next: "n", pages: [pageIn(mine.text)], repo });
      return (await a.codex("pickup_handoff", { repo })).text;
    },
    ok: (t) => has(t, "[F11-MINE]") && !has(t, "[F11-OTHER]"),
  },
  {
    id: "F12",
    name: "Two agents pick up the same baton at once",
    expect: "Exactly one takes it.",
    async run({ a, repo }) {
      await a.claude("save_handoff", { goal: "F12", state: "s", next: "n", repo });
      const both = await Promise.all([a.codex("pickup_handoff", { repo }), a.cursor("pickup_handoff", { repo })]);
      const took = both.filter((r) => /You've picked this up/.test(r.text)).length;
      return `TOOK ${took}`;
    },
    ok: (t) => t === "TOOK 1",
  },
];

async function account(base, tag) {
  const s = session(base, `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`, "baseline-eval-1");
  await s.signUp();
  return {
    ...s,
    claude: s.agent(await s.token("claude-code")),
    codex: s.agent(await s.token("codex")),
    cursor: s.agent(await s.token("cursor")),
  };
}

async function runTarget(name, base) {
  const results = [];
  for (const f of FIXTURES) {
    // Each fixture gets fresh accounts, so nothing carries over between them.
    const a = await account(base, f.id.toLowerCase());
    const other = await account(base, `${f.id.toLowerCase()}-other`);
    const skipped = [];
    const skip = async (p) => {
      const r = await p;
      if (r.unknownTool || /not found/i.test(r.text)) skipped.push("link_dependency");
      return r;
    };
    let text;
    try {
      text = await f.run({ a, other, repo: `eval/${f.id.toLowerCase()}`, skip });
    } catch (e) {
      text = `ERROR ${e.message}`;
    }
    const ok = !text.startsWith("ERROR") && f.ok(text);
    results.push({ id: f.id, ok, chars: text.length, skipped: [...new Set(skipped)], error: text.startsWith("ERROR") ? text : null });
    console.log(`${name.padEnd(18)} ${f.id.padEnd(4)} ${ok ? "PASS" : "FAIL"}${skipped.length ? " (no link_dependency here)" : ""}`);
  }
  return results;
}

async function main() {
  const all = {};
  for (const [name, base] of TARGETS) all[name] = await runTarget(name, base);
  const [b, m] = TARGETS.map(([n]) => all[n]);
  const score = (rs) => rs.filter((r) => r.ok).length;

  const rows = FIXTURES.map((f, i) => {
    const mark = (r) => (r.error ? "error" : r.ok ? "pass" : "fail");
    return `| ${f.id} | ${f.name} | ${f.expect} | ${mark(b[i])}${b[i].skipped.length ? "¹" : ""} | ${mark(m[i])} |`;
  });
  const both = FIXTURES.filter((_, i) => b[i].ok && m[i].ok).map((f) => f.id);
  const onlyM = FIXTURES.filter((_, i) => !b[i].ok && m[i].ok).map((f) => f.id);
  const onlyB = FIXTURES.filter((_, i) => b[i].ok && !m[i].ok).map((f) => f.id);
  const md = `# Baseline evaluation

Twelve frozen fixtures, run through the same MCP calls against the original LockIn (commit \`78a20d7\`, imported before the event) and against LockIn Manifest. The expectations were written before either system ran; see \`eval/baseline.mjs\`. Run on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.

| | Fixture | Correct means | LockIn (original) | LockIn Manifest |
|---|---|---|---|---|
${rows.join("\n")}
| | **Total** | | **${score(b)}/12** | **${score(m)}/12** |

¹ The original has no \`link_dependency\`, so that step was skipped and the fixture scored on what the original then handed over.

- Both pass: ${both.join(", ") || "none"}.
- Only LockIn Manifest passes: ${onlyM.join(", ") || "none"}.
- Only the original passes: ${onlyB.join(", ") || "none"}.

What these show and don't: each fixture checks one behaviour with markers in the note text, so a pass means the right text was (or wasn't) handed over, or the right refusal was given. They don't measure whether an agent then writes better code. The original's pickup is a snapshot of the pinned pages, by design; these fixtures are the cases where the notebook moved on after the baton was left.
`;
  writeFileSync(new URL("./RESULTS.md", import.meta.url), md);
  console.log(`\nOriginal ${score(b)}/12, Manifest ${score(m)}/12. Wrote eval/RESULTS.md.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
