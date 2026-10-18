// A small local agent for the demo video: a model served by llama.cpp
// (OpenAI-compatible API) that works through LockIn's MCP tools, one call at
// a time. Each turn the model answers in JSON, constrained by a schema so a
// small model can't produce something unparseable: either a tool to call and
// its arguments, or that it's done. The tool runs for real over MCP, and its
// reply goes back to the model.
//
// Every thought, call and reply is logged with its time, so the film can show
// exactly what the agent did (sped up, and labelled as such).

const LLM = process.env.LLM_URL ?? "http://127.0.0.1:8088/v1/chat/completions";

/** Calls a LockIn MCP tool, or lists the tools, with an agent's token. */
export function mcp(base, secret) {
  let id = 0;
  const rpc = async (method, params) => {
    const res = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const raw = await res.text();
    const body = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.split("\n").find((l) => l.startsWith("data:")).slice(5));
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
  return {
    list: async () => (await rpc("tools/list", {})).tools,
    call: async (name, args) => {
      const r = await rpc("tools/call", { name, arguments: args });
      return { text: r.content.map((c) => c.text).join("\n"), isError: Boolean(r.isError) };
    },
  };
}

const firstSentence = (s = "") => s.split(/(?<=\.)\s/)[0];

/** Drops arguments a small model sends as null or "" for "not given"; the tools treat missing as not given. */
const given = (args = {}) => Object.fromEntries(Object.entries(args).filter(([, v]) => v !== null && v !== ""));

/** A tool as the model sees it: its name, what it's for, and its arguments (only `keep`, when given). */
function describe(tool, keep) {
  const props = Object.fromEntries(Object.entries(tool.inputSchema?.properties ?? {}).filter(([k]) => !keep || keep.includes(k)));
  const req = new Set(tool.inputSchema?.required ?? []);
  const args = Object.entries(props).map(([k, v]) => `    ${k}${req.has(k) ? "" : "?"}: ${v.type ?? "any"}${v.description ? ` (${v.description})` : ""}`);
  return `- ${tool.name}: ${firstSentence(tool.description)}\n${args.join("\n")}`;
}

/** The reply a step must take: a thought, then one of the offered tools or "done". */
const schemaFor = (names) => ({
  type: "object",
  properties: {
    thought: { type: "string" },
    action: { type: "string", enum: [...names, "done"] },
    args: { type: "object" },
    summary: { type: "string" },
  },
  required: ["thought", "action"],
});

/**
 * An agent named `name` (its LockIn token's name) that runs tasks with the
 * tools it's given. `onEvent` gets each thought, call, result and finish.
 */
export function agent({ name, base, secret, onEvent = () => {} }) {
  const tools = mcp(base, secret);
  let catalogue = null;

  async function think(messages, names) {
    const res = await fetch(LLM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        temperature: 0.2,
        max_tokens: 400,
        response_format: { type: "json_object", schema: schemaFor(names) },
      }),
    });
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(text);
    } catch {
      return { thought: text.slice(0, 200), action: "done", summary: "I couldn't form a valid step." };
    }
  }

  /**
   * Runs one task and returns the tool replies it got. The task ends when the
   * agent says it's done, after `maxSteps`, or once every tool in `finishWith`
   * has succeeded (a small model can otherwise repeat a step that worked).
   */
  async function run(task, allowed, { maxSteps = 4, finishWith = allowed.length === 1 ? allowed : [], params = {} } = {}) {
    catalogue ??= await tools.list();
    const offered = catalogue.filter((t) => allowed.includes(t.name));
    const system = [
      `You are ${name}, a coding agent working through LockIn, a shared notebook for agents.`,
      "You act only by calling LockIn tools. Each turn, reply with JSON only:",
      '{"thought": "<one short sentence>", "action": "<tool name>", "args": {...}} to call a tool, or',
      '{"thought": "<one short sentence>", "action": "done", "summary": "<what you did, in one sentence>"} when the task is finished.',
      "Call each tool once for each thing the task asks. When a tool's reply shows it worked, don't call it again for the same thing.",
      "Use ids and page numbers exactly as the tools give them. Don't invent ids.",
      "",
      "Tools:",
      ...offered.map((t) => describe(t, params[t.name])),
    ].join("\n");
    const messages = [
      { role: "system", content: system },
      { role: "user", content: task },
    ];
    const replies = [];
    for (let step = 0; step < maxSteps; step++) {
      const t0 = Date.now();
      const next = await think(messages, allowed);
      onEvent({ agent: name, type: "thought", text: next.thought ?? "", ms: Date.now() - t0 });
      messages.push({ role: "assistant", content: JSON.stringify(next) });
      if (next.action === "done" || !allowed.includes(next.action)) {
        onEvent({ agent: name, type: "done", text: next.summary ?? "" });
        break;
      }
      // Only the arguments this step offers reach the tool.
      const keep = params[next.action];
      const args = Object.fromEntries(Object.entries(given(next.args)).filter(([k]) => !keep || keep.includes(k)));
      onEvent({ agent: name, type: "call", tool: next.action, args });
      const reply = await tools.call(next.action, args);
      replies.push({ tool: next.action, args, ...reply });
      onEvent({ agent: name, type: "result", tool: next.action, text: reply.text, isError: reply.isError });
      const succeeded = new Set(replies.filter((r) => !r.isError).map((r) => r.tool));
      if (finishWith.length > 0 && finishWith.every((t) => succeeded.has(t)) && !reply.isError) {
        onEvent({ agent: name, type: "done", text: "" });
        break;
      }
      messages.push({ role: "user", content: `Tool result${reply.isError ? " (error)" : ""}:\n${reply.text.slice(0, 2400)}\n\nContinue the task, or reply with done.` });
    }
    return replies;
  }

  return { name, run, tools };
}
