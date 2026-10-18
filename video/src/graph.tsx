import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, F, Label, useEnter } from "./theme";

// Graph pieces drawn in the notebook's hand: nodes are ruled index cards
// with a printed kind, relationships are pen lines that draw themselves,
// labelled in condensed caps.

export type Pt = { x: number; y: number };

export const NODE_W = 264;
export const NODE_H = 66;

const KIND_COLOR: Record<string, string> = {
  Agent: C.cloth,
  Baton: C.pen,
  Task: C.ink,
  Note: C.pen,
  Receipt: C.cloth,
  File: C.inkMuted,
};

export const GNode: React.FC<{
  at: Pt;
  kind: string;
  title: string;
  appear: number;
  tone?: "normal" | "current" | "retired" | "stale" | "highlight";
  w?: number;
}> = ({ at, kind, title, appear, tone = "normal", w = NODE_W }) => {
  const t = useEnter(appear, 16);
  const border =
    tone === "current" ? C.ok : tone === "stale" ? C.stamp : tone === "highlight" ? C.pen : tone === "retired" ? C.rule : C.rule;
  return (
    <div
      style={{
        position: "absolute",
        left: at.x - w / 2,
        top: at.y - NODE_H / 2,
        width: w,
        height: NODE_H,
        background: kind === "Agent" ? C.label : C.paper,
        border: `${tone === "normal" || tone === "retired" ? 1.5 : 2.5}px solid ${border}`,
        borderRadius: 2,
        boxShadow: "0 6px 16px rgba(27,42,47,0.10)",
        padding: "9px 14px",
        opacity: t * (tone === "retired" ? 0.55 : 1),
        transform: `scale(${0.9 + t * 0.1})`,
      }}
    >
      <Label size={11} color={KIND_COLOR[kind] ?? C.inkMuted}>
        {kind}
      </Label>
      <div
        style={{
          fontFamily: kind === "Note" ? F.prose : F.body,
          fontWeight: 600,
          fontSize: 18,
          color: C.ink,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          marginTop: 2,
          textDecoration: tone === "retired" ? "line-through" : "none",
        }}
      >
        {title}
      </div>
    </div>
  );
};

/** Where a line between two node centres meets each box's edge. */
function clipToBoxes(a: Pt, b: Pt, w = NODE_W) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const scale = (p: number) => {
    const sx = dx === 0 ? Infinity : (w / 2) / Math.abs(dx);
    const sy = dy === 0 ? Infinity : (NODE_H / 2) / Math.abs(dy);
    return Math.min(sx, sy) * p;
  };
  const s = scale(1) + 0.04;
  return { a: { x: a.x + dx * s, y: a.y + dy * s }, b: { x: b.x - dx * s, y: b.y - dy * s } };
}

export const GEdge: React.FC<{
  from: Pt;
  to: Pt;
  draw: number;
  label?: string;
  color?: string;
  dashed?: boolean;
  bold?: boolean;
  labelOffset?: Pt;
}> = ({ from, to, draw, label, color = C.inkMuted, dashed, bold, labelOffset = { x: 0, y: -14 } }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [draw, draw + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (p <= 0) return null;
  const { a, b } = clipToBoxes(from, to);
  const x = a.x + (b.x - a.x) * p;
  const y = a.y + (b.y - a.y) * p;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 11;
  const lt = interpolate(frame, [draw + 10, draw + 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} width="100%" height="100%">
      <line x1={a.x} y1={a.y} x2={x} y2={y} stroke={color} strokeWidth={bold ? 3 : 2} strokeDasharray={dashed ? "7 6" : undefined} />
      {p >= 1 ? (
        <polygon
          points={`${b.x},${b.y} ${b.x - head * Math.cos(angle - 0.4)},${b.y - head * Math.sin(angle - 0.4)} ${b.x - head * Math.cos(angle + 0.4)},${b.y - head * Math.sin(angle + 0.4)}`}
          fill={color}
        />
      ) : null}
      {label ? (
        <text
          x={(a.x + b.x) / 2 + labelOffset.x}
          y={(a.y + b.y) / 2 + labelOffset.y}
          textAnchor="middle"
          style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14, letterSpacing: "0.12em", fill: color, opacity: lt }}
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
};
