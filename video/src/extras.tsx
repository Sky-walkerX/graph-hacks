import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { GEdge, GNode } from "./graph";
import { CoverLabel } from "./scenes-intro";
import { Appear, C, F, Label, Paper, Terminal, useFonts } from "./theme";

// The README's banner, the graph model as a diagram that draws itself, and
// the setup film.

export const Banner: React.FC = () => {
  useFonts();
  return (
    <Paper margin={88}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 40, paddingTop: 10 }}>
        <CoverLabel at={-100} scale={0.86} stamp="Manifest" stampAt={-100} />
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 58, color: C.ink }}>Handoffs that know when they went stale.</div>
      </AbsoluteFill>
    </Paper>
  );
};

/** The graph model: who did what, what rests on what, and what was handed over. */
export const GraphModel: React.FC = () => {
  useFonts();
  const frame = useCurrentFrame();
  const p = interpolate(frame, [80, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const N = {
    agent: { x: 240, y: 150 },
    receipt: { x: 240, y: 450 },
    baton: { x: 620, y: 150 },
    task: { x: 620, y: 450 },
    old: { x: 1000, y: 450 },
    cur: { x: 1380, y: 450 },
    pinned: { x: 1000, y: 150 },
    file: { x: 1380, y: 150 },
  };
  return (
    <Paper margin={40}>
      <Appear from={0} style={{ position: "absolute", left: 90, top: 40 }}>
        <Label size={16} color={C.ink}>
          The graph · one per account · FalkorDB
        </Label>
      </Appear>
      <GNode at={N.agent} kind="Agent" title="Codex" appear={4} />
      <GNode at={N.baton} kind="Baton" title="Retry failed payments" appear={12} />
      <GNode at={N.task} kind="Task" title="Add retry with backoff" appear={20} />
      <GNode at={N.old} kind="Note" title="p. 9 Retry on 5xx" appear={28} tone="retired" />
      <GNode at={N.cur} kind="Note" title="p. 11 No automatic retries" appear={36} tone="current" />
      <GNode at={N.pinned} kind="Note" title="p. 10 Payments API" appear={44} />
      <GNode at={N.file} kind="File" title="lib/checkout/pay.ts" appear={52} />
      <GNode at={N.receipt} kind="Receipt" title="9f2c41d0" appear={60} />

      <GEdge from={N.agent} to={N.baton} draw={16} label="LEFT" />
      <GEdge from={N.baton} to={N.task} draw={24} label="FOR" labelOffset={{ x: 22, y: 4 }} />
      <GEdge from={N.task} to={N.old} draw={32} label="DEPENDS_ON" labelOffset={{ x: 0, y: -16 }} />
      <GEdge from={N.cur} to={N.old} draw={40} label="SUPERSEDES" color={C.stamp} bold labelOffset={{ x: 0, y: -16 }} />
      <GEdge from={N.baton} to={N.pinned} draw={48} label="PINS" />
      <GEdge from={N.pinned} to={N.file} draw={56} label="ABOUT_FILE" />
      <GEdge from={N.agent} to={N.receipt} draw={64} label="RECEIVED" labelOffset={{ x: 50, y: 4 }} />
      <GEdge from={N.task} to={N.receipt} draw={72} label="DONE_WITH" labelOffset={{ x: 0, y: -16 }} color={C.cloth} />
      <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width="100%" height="100%">
        {(() => {
          const d = `M ${N.receipt.x} ${N.receipt.y + 34} C ${N.receipt.x} 640, ${N.cur.x} 640, ${N.cur.x} ${N.cur.y + 34}`;
          return (
            <>
              <path d={d} fill="none" stroke={C.pen} strokeWidth={2} strokeDasharray="7 6" opacity={p} />
              <text x={(N.receipt.x + N.cur.x) / 2} y={628} textAnchor="middle" style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14, letterSpacing: "0.12em", fill: C.pen, opacity: p }}>
                DELIVERED {"{hash, why}"}
              </text>
            </>
          );
        })()}
      </svg>
      <Appear from={100} style={{ position: "absolute", left: 90, right: 90, bottom: 34, display: "flex", gap: 40, fontFamily: F.body, fontSize: 17, color: C.inkMuted }}>
        <span>
          <b style={{ color: C.ink }}>Postgres</b> keeps notes, tasks and batons.
        </span>
        <span>
          <b style={{ color: C.ink }}>FalkorDB</b> walks them, and alone holds dependencies, receipts and outcomes.
        </span>
      </Appear>
    </Paper>
  );
};

/** Setup, as it really runs: compose up, then the scenario. */
export const Setup: React.FC = () => {
  useFonts();
  const frame = useCurrentFrame();
  const services = [
    ["db", "Postgres 17", "healthy", 70],
    ["falkordb", "FalkorDB 4.22", "healthy", 82],
    ["migrate", "prisma migrate deploy", "exited 0", 98],
    ["app", "LockIn on :3000", "healthy", 116],
  ] as const;
  return (
    <Paper margin={40}>
      <Appear from={0} style={{ position: "absolute", left: 90, top: 40 }}>
        <Label size={16} color={C.ink}>
          Setup · Docker Compose · about five minutes
        </Label>
      </Appear>
      <Terminal
        title="Terminal"
        width={880}
        height={560}
        style={{ position: "absolute", left: 90, top: 86 }}
        fontSize={18}
        lines={[
          { at: 4, text: "$ git clone https://github.com/Sky-walkerX/graph-hacks", color: C.termInk, type: true },
          { at: 30, text: "$ cd graph-hacks && cp .env.example .env", color: C.termInk, type: true },
          { at: 46, text: "$ # set AUTH_SECRET:  openssl rand -base64 32", color: C.termMuted },
          { at: 56, text: "$ docker compose up -d --build", color: C.termInk, type: true },
          { at: 130, text: "✓ up on http://localhost:3000", color: C.termGreen },
          { at: 146, text: "$ node eval/scenario.mjs", color: C.termInk, type: true },
          { at: 166, text: "PASS pickup returns a context manifest with a receipt", color: C.termGreen },
          { at: 172, text: "PASS ticking done against a changed context is refused", color: C.termGreen },
          { at: 178, text: "PASS trace_task flags finished work whose context changed", color: C.termGreen },
          { at: 184, text: "PASS who_knows marks codex's version out of date", color: C.termGreen },
          { at: 192, text: "All 21 checks passed.", color: C.termGreen },
          { at: 204, text: "Account: demo-…@example.com / manifest-demo-1", color: C.termMuted },
        ]}
      />
      <div style={{ position: "absolute", left: 1020, top: 110, width: 490 }}>
        <Label size={14}>Services</Label>
        {services.map(([name, what, status, at]) => {
          const on = frame >= at;
          return (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "12px 16px", background: C.paper, border: `1.5px solid ${on ? C.ok : C.rule}`, borderRadius: 2, boxShadow: "0 6px 16px rgba(27,42,47,0.08)", opacity: frame >= 60 ? 1 : 0.35 }}>
              <div>
                <div style={{ fontFamily: F.mono, fontSize: 17, color: C.ink }}>{name}</div>
                <div style={{ fontFamily: F.body, fontSize: 14, color: C.inkMuted }}>{what}</div>
              </div>
              <div style={{ fontFamily: F.display, fontWeight: 700, letterSpacing: "0.12em", fontSize: 14, textTransform: "uppercase", color: on ? C.ok : C.inkMuted }}>{on ? `✓ ${status}` : "starting"}</div>
            </div>
          );
        })}
        <Appear from={214} style={{ marginTop: 26 }}>
          <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 26, color: C.ink, lineHeight: 1.35 }}>Sign in with the printed account: the home page shows Codex out of date.</div>
        </Appear>
      </div>
    </Paper>
  );
};

/** The blog's cover, at dev.to's 1000×420. */
export const BlogCover: React.FC = () => {
  useFonts();
  return (
    <Paper margin={48}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 26 }}>
        <CoverLabel at={-100} scale={0.6} stamp="Manifest" stampAt={-100} />
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 34, color: C.ink }}>Every agent handoff, with a receipt.</div>
        <Label size={14} color={C.ink}>
          Built on FalkorDB · Graph Hacks 2026
        </Label>
      </AbsoluteFill>
    </Paper>
  );
};
