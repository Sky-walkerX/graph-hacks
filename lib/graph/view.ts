import type { Graph } from "falkordb";
import { read } from "./client";
import { CHAIN, CONTEXT_HOPS } from "./context";

// A receipt as a picture: exactly the nodes and relationships the graph
// returns for it, nothing drawn that a query didn't return. The agent that
// received it, the receipt and its baton, the walk from the baton to the
// notes it reaches, those notes' replacement chains (witnessed or proposed),
// and which notes the receipt delivered.

export type ViewNode = { id: string; kind: string; label: string; page: number | null; witnessed: boolean | null; deleted: boolean | null };
export type ViewEdge = { type: string; from: string; to: string; accepted: boolean | null };
export type View = { nodes: ViewNode[]; edges: ViewEdge[]; delivered: string[] };

const NODE = `{id: x.id, kind: labels(x)[0], label: coalesce(x.title, x.goal, x.name, x.id), page: x.page, witnessed: x.witnessed, deleted: x.deleted}`;
const EDGE = `{type: type(e), from: startNode(e).id, to: endNode(e).id, accepted: e.accepted}`;

export async function receiptView(graph: Graph, receiptId: string): Promise<View | null> {
  const [head] = await read<{ agent: string; handoff: ViewNode; receipt: ViewNode; delivered: string[] }>(
    graph,
    `MATCH (a:Agent)-[:RECEIVED]->(r:Receipt {id: $id})-[:FOR]->(h:Handoff)
     OPTIONAL MATCH (r)-[:DELIVERED]->(d:Note)
     RETURN a.name AS agent,
            {id: h.id, kind: 'Handoff', label: h.goal, page: null, witnessed: null, deleted: null} AS handoff,
            {id: r.id, kind: 'Receipt', label: 'receipt', page: null, witnessed: null, deleted: null} AS receipt,
            collect(d.id) AS delivered`,
    { id: receiptId },
  );
  if (!head) return null;
  const nodes = new Map<string, ViewNode>();
  const edges = new Map<string, ViewEdge>();
  const addEdge = (e: ViewEdge) => edges.set(`${e.type}:${e.from}:${e.to}`, e);
  const agentId = `agent:${head.agent}`;
  nodes.set(agentId, { id: agentId, kind: "Agent", label: head.agent, page: null, witnessed: null, deleted: null });
  nodes.set(head.receipt.id, head.receipt);
  nodes.set(head.handoff.id, head.handoff);
  addEdge({ type: "RECEIVED", from: agentId, to: head.receipt.id, accepted: null });
  addEdge({ type: "FOR", from: head.receipt.id, to: head.handoff.id, accepted: null });

  const walks = await read<{ ns: ViewNode[]; es: ViewEdge[] }>(
    graph,
    `MATCH p = (h:Handoff {id: $h})-[:PINS|ABOUT|FOR|DEPENDS_ON*1..${CONTEXT_HOPS}]->(n:Note)
     RETURN [x IN nodes(p) | ${NODE}] AS ns, [e IN relationships(p) | ${EDGE}] AS es`,
    { h: head.handoff.id },
  );
  for (const w of walks) {
    for (const n of w.ns) nodes.set(n.id, n);
    for (const e of w.es) addEdge(e);
  }
  const reached = [...nodes.values()].filter((n) => n.kind === "Note").map((n) => n.id);
  const ids = [...new Set([...reached, ...head.delivered])];
  const chains = await read<{ ns: ViewNode[]; es: ViewEdge[] }>(
    graph,
    `UNWIND $ids AS id
     MATCH (n:Note {id: id})
     WITH n
     MATCH p = (n)<-[:SUPERSEDES*1..${CHAIN}]-(m:Note)
     RETURN [x IN nodes(p) | ${NODE}] AS ns, [e IN relationships(p) | ${EDGE}] AS es`,
    { ids },
  );
  for (const c of chains) {
    for (const n of c.ns) nodes.set(n.id, n);
    for (const e of c.es) addEdge(e);
  }
  // A delivered note the walk no longer reaches (replaced since) is still drawn.
  const missing = head.delivered.filter((id) => !nodes.has(id));
  if (missing.length > 0) {
    const rows = await read<{ n: ViewNode }>(graph, `UNWIND $ids AS id MATCH (x:Note {id: id}) RETURN ${NODE} AS n`, { ids: missing });
    for (const { n } of rows) nodes.set(n.id, n);
  }
  for (const id of head.delivered) addEdge({ type: "DELIVERED", from: head.receipt.id, to: id, accepted: null });
  return { nodes: [...nodes.values()], edges: [...edges.values()], delivered: head.delivered };
}
