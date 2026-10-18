// A notebook made from this project's own build: real decisions taken while
// building LockIn Manifest for Graph Hacks on 18 October 2026, the lessons
// behind them, and the work that leaned on them. Unlike the checkout story
// (eval/scenario.mjs), nothing here is invented: each note says what we
// decided and why, as the commit history shows.
//
//   BASE=http://localhost:3000 node eval/dogfood.mjs
//
// It leaves one real stale handoff: the agent writing the README picked up
// work that rested on the project's name, and the name changed after.
// Prints the login.

import { agent, signUp, token, witness, EMAIL, PASSWORD, BASE } from "./lib.mjs";

const idIn = (t) => t.match(/Note id ([0-9a-f-]{36})/)?.[1];
const pageIn = (t) => Number(t.match(/on page (\d+)/)?.[1]);
const taskIn = (t) => t.match(/([0-9a-f-]{36})/)?.[1];
const REPO = "Sky-walkerX/graph-hacks";

async function main() {
  await signUp();
  const claude = agent(await token("claude-code"));
  const codex = agent(await token("codex"));
  const note = async (title, body, files = []) => {
    const r = await claude("save_note", { title, body, repo: REPO, files });
    await witness(idIn(r.text));
    return { id: idIn(r.text), page: pageIn(r.text) };
  };

  // What we learned and decided, in the order it happened.
  const name = await note(
    "Name: LockIn Relay",
    "The entry is called **LockIn Relay**: agents relay work to each other through LockIn's batons.",
    ["README.md"],
  );
  const exists = await note(
    "FalkorDB: exists(pattern) is not a pattern test",
    "In FalkorDB v4.22, `exists((a)-[:R]->(b))` in a RETURN came back **true** for a pattern with no match, which made every dependency look like a loop. Count instead: `size([(a)-[:R]->(b) | 1]) > 0`. In a WHERE clause, `NOT (a)-[:R]->(b)` works as expected.",
    ["lib/graph/context.ts"],
  );
  const bundling = await note(
    "Next: falkordb must not be bundled",
    "Bundled by Turbopack, the falkordb client's Temporal polyfill fails at load (`e.BigInt is not a function`). It's in `serverExternalPackages` in next.config.ts.",
    ["next.config.ts"],
  );
  const claim = await note(
    "Pickup must check its own claim",
    "The original pickup marked a baton taken but never checked whether its claim was the one that landed. With 8 agents racing, 0/10 rounds had one winner (eval/RESULTS.md). pickup_handoff now refuses when markPickedUp updates nothing.",
    ["app/api/mcp/route.ts", "lib/handoff/store.ts"],
  );
  const authority = await note(
    "Postgres is the authority; the graph is projected",
    "Notes, tasks and batons stay in Postgres. lib/graph/project.ts projects them into FalkorDB before every graph read, from an updatedAt watermark. Dependencies and receipts live only in the graph and are never rebuilt from Postgres.",
    ["lib/graph/project.ts"],
  );

  // Work that rests on those decisions.
  const readme = await claude("add_task", { title: "Write the submission README", note_id: name.id });
  const video = await claude("add_task", { title: "Record the demo video", note_id: name.id });
  const tests = await claude("add_task", { title: "Graph tests against real FalkorDB", note_id: exists.id });
  for (const [t, on] of [[readme, name], [video, name], [tests, exists], [tests, authority]]) {
    await claude("link_dependency", { task_id: taskIn(t.text), depends_on: on.id, reason: "built on this decision" });
  }
  await claude("link_dependency", { note_id: claim.id, depends_on: authority.id, reason: "the claim is in Postgres; receipts in the graph" });
  await claude("link_dependency", { note_id: exists.id, depends_on: bundling.id, reason: "tests run the same client" });

  // Claude Code hands the README to Codex, which picks it up.
  await claude("save_handoff", {
    goal: "Write the submission README for LockIn Relay",
    state: "Research, graph model and queries are done; README not started.",
    next: "Lead with the problem and the demo, then the graph model and the Cypher.",
    next_at: "README.md:1",
    pages: [authority.page],
    task_id: taskIn(readme.text),
    repo: REPO,
  });
  await codex("pickup_handoff", { repo: REPO });

  // Then the competitor sweep found three other entries called Relay.
  const renamed = await claude("supersede_note", {
    id: name.id,
    title: "Name: LockIn Manifest",
    body: "Renamed from LockIn Relay: the competitor sweep at 15:10 IST found three other Graph Hacks entries already called Relay. A manifest is the list of exactly what was handed over at each transfer, which is what the receipt is.",
    repo: REPO,
    files: ["README.md"],
  });
  await witness(idIn(renamed.text));

  console.log(`Dogfood notebook on ${BASE}: ${EMAIL} / ${PASSWORD}`);
  console.log("Codex is writing the README for a name that changed after it picked the work up: the home page shows it out of date.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
