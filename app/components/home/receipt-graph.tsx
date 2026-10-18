"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/fetcher";
import { sourceLabel } from "@/lib/notes/source";
import { pageLabel } from "@/lib/notes/page-label";
import type { View, ViewEdge, ViewNode } from "@/lib/graph/view";

// One receipt, drawn from what the graph returns for it (lib/graph/view.ts):
// the agent, the receipt, the baton, the walk to the notes it reaches, and
// those notes' replacement chains. Rows are steps from the agent, top to
// bottom; dashed lines are what the receipt delivered. Hovering a node lights up its
// relationships. Nothing is drawn that a query didn't return.

const COL = 214;
const ROW = 74;
const W = 196;
const H = 44;
const PAD = 12;

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function layout(view: View) {
  // Rows: steps from the agent, ignoring what the receipt delivered (those
  // would pull every note up next to the receipt).
  const start = view.nodes.find((n) => n.kind === "Agent")!.id;
  const near = new Map<string, string[]>();
  for (const e of view.edges) {
    if (e.type === "DELIVERED") continue;
    near.set(e.from, [...(near.get(e.from) ?? []), e.to]);
    near.set(e.to, [...(near.get(e.to) ?? []), e.from]);
  }
  const rank = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of near.get(id) ?? []) {
      if (!rank.has(next)) {
        rank.set(next, rank.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  const maxRank = Math.max(0, ...rank.values());
  for (const n of view.nodes) if (!rank.has(n.id)) rank.set(n.id, maxRank + 1);
  const rows = new Map<number, ViewNode[]>();
  for (const n of view.nodes) rows.set(rank.get(n.id)!, [...(rows.get(rank.get(n.id)!) ?? []), n]);
  const pos = new Map<string, { x: number; y: number }>();
  const widest = Math.max(...[...rows.values()].map((r) => r.length));
  for (const [r, list] of rows) {
    const offset = ((widest - list.length) * COL) / 2;
    list.forEach((n, i) => pos.set(n.id, { x: PAD + offset + i * COL, y: PAD + r * ROW }));
  }
  const width = PAD * 2 + (widest - 1) * COL + W;
  const height = PAD * 2 + Math.max(...rank.values()) * ROW + H;
  return { pos, width, height };
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  if (a.y === b.y) {
    // Same row: side to side.
    const right = b.x > a.x;
    const x1 = right ? a.x + W : a.x;
    const x2 = right ? b.x : b.x + W;
    return `M ${x1} ${a.y + H / 2} L ${x2} ${b.y + H / 2}`;
  }
  const down = b.y > a.y;
  const x1 = a.x + W / 2;
  const x2 = b.x + W / 2;
  const y1 = down ? a.y + H : a.y;
  const y2 = down ? b.y : b.y + H;
  const bend = Math.max(24, Math.abs(y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + (down ? bend : -bend)}, ${x2} ${y2 - (down ? bend : -bend)}, ${x2} ${y2}`;
}

const edgeClass = (e: ViewEdge) =>
  e.type === "DELIVERED"
    ? "lk-graph-edge-delivered"
    : e.type === "SUPERSEDES"
      ? e.accepted
        ? "lk-graph-edge-replaced"
        : "lk-graph-edge-proposed"
      : "lk-graph-edge";

const edgeLabel = (e: ViewEdge) => (e.type === "SUPERSEDES" ? (e.accepted ? "replaces" : "proposes to replace") : e.type.toLowerCase().replace("_", " "));

/** A node's printed kind (condensed caps) and its title. */
function nodeText(n: ViewNode): [string, string] {
  switch (n.kind) {
    case "Agent":
      return ["Agent", sourceLabel(n.label)];
    case "Receipt":
      return ["Receipt", n.id.slice(0, 8)];
    case "Handoff":
      return ["Baton", clip(n.label, 26)];
    case "Task":
      return ["Task", clip(n.label, 26)];
    default:
      return [
        `${n.page != null ? pageLabel(n.page) : "Note"}${n.witnessed === false ? " · awaiting witness" : ""}${n.deleted ? " · deleted" : ""}`,
        clip(n.label, 26),
      ];
  }
}

export function ReceiptGraph({ receiptId }: { receiptId: string }) {
  const { data, error } = useQuery({
    queryKey: ["manifest-graph", receiptId],
    queryFn: () => api.get<View>(`/api/manifest/graph?receipt=${receiptId}`),
  });
  const [hover, setHover] = useState<string | null>(null);
  const laid = useMemo(() => (data ? layout(data) : null), [data]);
  if (error) return <p className="text-sm text-muted-foreground">The graph can&apos;t be drawn right now.</p>;
  if (!data || !laid) return <p className="text-sm text-muted-foreground">Reading the graph…</p>;
  const replaced = new Set(data.edges.filter((e) => e.type === "SUPERSEDES" && e.accepted).map((e) => e.to));
  const delivered = new Set(data.delivered);
  const lit = (e: ViewEdge) => hover !== null && (e.from === hover || e.to === hover);
  return (
    <figure className="lk-graph">
      <div className="lk-graph-scroll lk-paper">
        <svg
          viewBox={`0 0 ${laid.width} ${laid.height}`}
          // Scales down to the panel; below 420px wide it scrolls instead of shrinking further.
          style={{ width: "100%", maxWidth: laid.width, minWidth: Math.min(laid.width, 420), height: "auto" }}
          role="img"
          aria-label={`The graph behind receipt ${receiptId.slice(0, 8)}: ${data.nodes.length} nodes, ${data.edges.length} relationships`}
        >
          <defs>
            <marker id="lk-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="lk-graph-arrow" />
            </marker>
          </defs>
          {data.edges.map((e) => {
            const a = laid.pos.get(e.from);
            const b = laid.pos.get(e.to);
            if (!a || !b) return null;
            return (
              <path
                key={`${e.type}:${e.from}:${e.to}`}
                d={edgePath(a, b)}
                className={`${edgeClass(e)}${lit(e) ? " lk-graph-lit" : ""}`}
                markerEnd="url(#lk-arrow)"
              >
                <title>{edgeLabel(e)}</title>
              </path>
            );
          })}
          {data.nodes.map((n) => {
            const p = laid.pos.get(n.id)!;
            const [kind, title] = nodeText(n);
            const cls = [
              "lk-graph-node",
              `lk-graph-${n.kind.toLowerCase()}`,
              delivered.has(n.id) ? "lk-graph-delivered" : "",
              replaced.has(n.id) ? "lk-graph-retired" : "",
              n.kind === "Note" && !replaced.has(n.id) && n.witnessed ? "lk-graph-current" : "",
            ].join(" ");
            return (
              <g key={n.id} transform={`translate(${p.x} ${p.y})`} className={cls} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}>
                <rect width={W} height={H} rx={2} />
                <text x={10} y={17} className="lk-graph-kind">
                  {kind}
                </text>
                <text x={10} y={35} className={n.kind === "Note" ? "lk-graph-title lk-graph-title-note" : "lk-graph-title"}>
                  {title}
                </text>
                <title>{`${n.kind}: ${n.label}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="lk-graph-legend">
        <span>
          <i className="lk-graph-key lk-graph-key-delivered" /> delivered in this receipt
        </span>
        <span>
          <i className="lk-graph-key lk-graph-key-replaced" /> replaces (witnessed)
        </span>
        <span>
          <i className="lk-graph-key lk-graph-key-proposed" /> proposed, not witnessed
        </span>
        <span>Faded: a page a witnessed replacement retired.</span>
      </figcaption>
    </figure>
  );
}
