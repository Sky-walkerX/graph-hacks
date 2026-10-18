// Shared by the eval scripts: an account on a running LockIn, agent tokens,
// and MCP tool calls made the way an agent makes them.

export const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
export const EMAIL = process.env.EMAIL ?? `demo-${Date.now()}@example.com`;
export const PASSWORD = process.env.PASSWORD ?? "manifest-demo-1";

export const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** A signed-in browser session on one instance, with its own cookie jar. */
export function session(base = BASE, email = EMAIL, password = PASSWORD) {
  base = base.replace(/\/$/, "");
  const jar = new Map();

  async function web(path, init = {}) {
    const res = await fetch(base + path, {
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

  async function signUp() {
    const reg = await web("/api/register", json({ email, password, name: "Demo" }));
    if (!reg.ok) throw new Error(`register: ${reg.status} ${await reg.text()}`);
    const { csrfToken } = await (await web("/api/auth/csrf")).json();
    const form = new URLSearchParams({ csrfToken, email, password, json: "true" });
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
      const res = await fetch(`${base}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
      });
      const raw = await res.text();
      // Streamable HTTP answers as JSON or as one SSE event.
      const body = raw.startsWith("{") ? JSON.parse(raw) : JSON.parse(raw.split("\n").find((l) => l.startsWith("data:")).slice(5));
      if (body.error) return { text: body.error.message, isError: true, unknownTool: /not found|unknown tool/i.test(body.error.message) };
      const text = body.result.content.map((c) => c.text).join("\n");
      return { text, isError: Boolean(body.result.isError), unknownTool: /Tool .* not found/i.test(text) };
    };
  }

  /** The user witnesses a note in the app. */
  async function witness(noteId) {
    const res = await web(`/api/milestones/${noteId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ witnessed: true }) });
    if (!res.ok) throw new Error(`witness: ${res.status}`);
  }

  /** The user deletes a note in the app. */
  async function remove(noteId) {
    const res = await web(`/api/milestones/${noteId}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`delete: ${res.status}`);
  }

  return { base, email, password, web, signUp, token, agent, witness, remove };
}

const main = session();
export const { web, signUp, token, agent, witness } = main;
