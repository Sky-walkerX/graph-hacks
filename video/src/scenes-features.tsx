import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { GEdge, GNode } from "./graph";
import { CoverLabel } from "./scenes-intro";
import { Appear, C, Caption, F, Label, NoteCard, Paper, Stamp, Terminal, useEnter } from "./theme";

// Part two: what LockIn Manifest adds, one scene per feature, each showing
// the real tool calls and replies (shortened) and the graph behind them.

const Card: React.FC<{ children: React.ReactNode; width?: number | string; style?: React.CSSProperties; border?: string }> = ({ children, width = 440, style, border = C.rule }) => (
  <div style={{ width, background: C.paper, border: `1.5px solid ${border}`, borderRadius: 2, boxShadow: "0 10px 26px rgba(27,42,47,0.12)", padding: "14px 18px 16px", ...style }}>
    {children}
  </div>
);

const Row: React.FC<{ page: string; title: string; rev?: string; note?: string; color?: string }> = ({ page, title, rev, note, color = C.ink }) => (
  <div style={{ display: "grid", gridTemplateColumns: "56px 1fr auto", gap: 10, alignItems: "baseline", padding: "7px 0", borderTop: `1px solid ${C.rule}`, fontFamily: F.body, fontSize: 16, color }}>
    <b style={{ fontFamily: F.display, letterSpacing: "0.06em" }}>{page}</b>
    <div>
      <span style={{ fontFamily: F.prose, fontSize: 17 }}>{title}</span>
      {note ? <div style={{ fontSize: 13.5, color: C.inkMuted, marginTop: 2 }}>{note}</div> : null}
    </div>
    {rev ? <code style={{ fontFamily: F.mono, fontSize: 13, color: C.inkMuted }}>{rev}</code> : null}
  </div>
);

const Receipt: React.FC<{ id: string; rows: { page: string; title: string; rev: string; note?: string }[]; width?: number; border?: string }> = ({ id, rows, width = 470, border }) => (
  <Card width={width} border={border}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
      <Label size={13} color={C.cloth}>
        Receipt {id}
      </Label>
      <Label size={11}>What was handed over</Label>
    </div>
    {rows.map((r) => (
      <Row key={r.page} {...r} />
    ))}
  </Card>
);

// ── 1. Every handoff comes with a receipt ───────────────────────────────

export const FReceipt: React.FC = () => (
  <Paper>
    <Terminal
      title="Codex · picking up"
      width={600}
      height={420}
      style={{ position: "absolute", left: 110, top: 110 }}
      fontSize={18}
      lines={[
        { at: 4, text: "> carry on the checkout work", color: C.termInk },
        { at: 14, text: "pickup_handoff()", color: C.termBlue },
        { at: 26, text: "● FalkorDB walks from the baton…", color: C.termMuted },
        { at: 112, text: "✓ Picked up · receipt c540e718", color: C.termGreen },
        { at: 118, text: "  p. 9  via task → depends on", color: C.termMuted },
        { at: 122, text: "  p. 10 pinned by the baton", color: C.termMuted },
      ]}
    />
    <GNode at={{ x: 1150, y: 150 }} kind="Baton" title="Retry failed payments" appear={28} />
    <GNode at={{ x: 960, y: 300 }} kind="Task" title="Add retry with backoff" appear={42} />
    <GNode at={{ x: 1350, y: 300 }} kind="Note" title="p. 10 Payments API" appear={56} tone="highlight" />
    <GNode at={{ x: 960, y: 450 }} kind="Note" title="p. 9 Retry on 5xx" appear={70} tone="highlight" />
    <GEdge from={{ x: 1150, y: 150 }} to={{ x: 960, y: 300 }} draw={42} label="FOR" labelOffset={{ x: -24, y: -6 }} />
    <GEdge from={{ x: 1150, y: 150 }} to={{ x: 1350, y: 300 }} draw={56} label="PINS" labelOffset={{ x: 28, y: -6 }} />
    <GEdge from={{ x: 960, y: 300 }} to={{ x: 960, y: 450 }} draw={70} label="DEPENDS_ON" labelOffset={{ x: 66, y: 4 }} />
    <Appear from={96} style={{ position: "absolute", left: 1120, top: 410 }}>
      <Receipt
        id="c540e718"
        width={400}
        rows={[
          { page: "p. 9", title: "Retry the payment on 5xx", rev: "c263a355" },
          { page: "p. 10", title: "Payments API: charge", rev: "95077bde" },
        ]}
      />
    </Appear>
    <Caption n={4} text="Every handoff comes with a receipt." at={8} />
  </Paper>
);

// ── 2. Witnessed replacements are followed; proposals come with a warning ─

export const FFollowed: React.FC = () => (
  <Paper>
    <GNode at={{ x: 290, y: 170 }} kind="Task" title="Add retry with backoff" appear={4} />
    <GNode at={{ x: 290, y: 360 }} kind="Note" title="p. 9 Retry on 5xx" appear={10} tone="retired" />
    <GNode at={{ x: 740, y: 360 }} kind="Note" title="p. 11 No automatic retries" appear={30} tone="current" />
    <GNode at={{ x: 740, y: 550 }} kind="Note" title="p. 12 Retry with a key?" appear={64} tone="normal" />
    <GEdge from={{ x: 290, y: 170 }} to={{ x: 290, y: 360 }} draw={10} label="DEPENDS_ON" labelOffset={{ x: 66, y: 4 }} />
    <GEdge from={{ x: 740, y: 360 }} to={{ x: 290, y: 360 }} draw={36} label="REPLACES · WITNESSED" color={C.stamp} bold labelOffset={{ x: 0, y: -16 }} />
    <GEdge from={{ x: 740, y: 550 }} to={{ x: 740, y: 360 }} draw={70} label="PROPOSED" color={C.warn} dashed labelOffset={{ x: 50, y: 4 }} />
    <Appear from={86} style={{ position: "absolute", left: 980, top: 200 }}>
      <Card width={500}>
        <Label size={13} color={C.cloth}>
          Context manifest
        </Label>
        <Row page="p. 11" title="No automatic retries" note="Stands in for p. 9, replaced as witnessed: p. 9 → p. 11" />
        <Row page="p. 10" title="Payments API: charge" note="Pinned by the baton" />
        <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 10, marginTop: 4 }}>
          <Label size={12} color={C.warn}>
            Careful
          </Label>
          <div style={{ fontFamily: F.body, fontSize: 15.5, color: C.warn, marginTop: 4 }}>
            p. 11 has a replacement waiting to be witnessed (p. 12). It may be about to change.
          </div>
        </div>
      </Card>
    </Appear>
    <Caption n={5} text="Witnessed changes are followed. Proposals get a warning." at={8} />
  </Paper>
);

// ── 3. Impact before you approve ────────────────────────────────────────

export const FImpact: React.FC = () => (
  <Paper>
    <Terminal
      title="Claude Code"
      width={720}
      height={470}
      style={{ position: "absolute", left: 110, top: 100 }}
      fontSize={17}
      lines={[
        { at: 4, text: "● The payments API isn't idempotent.", color: C.termMuted },
        { at: 12, text: "supersede_note(p. 9,", color: C.termBlue },
        { at: 18, text: '  "No automatic retries until keys")', color: C.termGreen },
        { at: 40, text: "Saved p. 11 to replace p. 9.", color: C.termInk },
        { at: 52, text: "Once witnessed, this affects:", color: C.termInk },
        { at: 64, text: '- Task "Add retry with backoff" (open)', color: C.termRed },
        { at: 74, text: '- Baton "Retry failed payments" (picked up)', color: C.termRed },
        { at: 86, text: "- codex: handed p. 9, out of date", color: C.termRed },
      ]}
    />
    <GNode at={{ x: 1220, y: 140 }} kind="Note" title="p. 9 Retry on 5xx" appear={30} tone="stale" />
    <GNode at={{ x: 1060, y: 300 }} kind="Task" title="Add retry with backoff" appear={60} tone="stale" />
    <GNode at={{ x: 1380, y: 300 }} kind="Agent" title="Codex" appear={84} tone="stale" />
    <GNode at={{ x: 1060, y: 460 }} kind="Baton" title="Retry failed payments" appear={72} tone="stale" />
    <GEdge from={{ x: 1060, y: 300 }} to={{ x: 1220, y: 140 }} draw={62} label="DEPENDS_ON" color={C.stamp} labelOffset={{ x: -70, y: 0 }} />
    <GEdge from={{ x: 1060, y: 460 }} to={{ x: 1060, y: 300 }} draw={74} label="FOR" color={C.stamp} labelOffset={{ x: 24, y: 4 }} />
    <GEdge from={{ x: 1380, y: 300 }} to={{ x: 1220, y: 140 }} draw={86} label="WAS HANDED" color={C.stamp} dashed labelOffset={{ x: 66, y: 0 }} />
    <Caption n={6} text="See what a change affects, before you approve it." at={8} />
  </Paper>
);

// ── 4. Agents are told when the ground moves ────────────────────────────

export const FTold: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Paper>
      <Terminal
        title="Codex · Claude Code plugin"
        width={760}
        height={430}
        style={{ position: "absolute", left: 110, top: 110 }}
        fontSize={17}
        lines={[
          { at: 4, text: "> add a test for 3 retries on 503", color: C.termInk },
          { at: 22, text: "⚑ LockIn: your context changed since pickup", color: C.termRed },
          { at: 28, text: '  REPLACED p. 9 → p. 11 "No automatic retries"', color: C.termRed },
          { at: 34, text: "  via baton → task → p. 9", color: C.termMuted },
          { at: 70, text: "check_context()", color: C.termBlue },
          { at: 96, text: "✓ New receipt 9f2c41d0", color: C.termGreen },
          { at: 100, text: "  p. 11 handed over in full", color: C.termMuted },
          { at: 120, text: "● Dropping the retry loop; surfacing the error.", color: C.termMuted },
        ]}
      />
      <div style={{ position: "absolute", left: 960, top: 120, opacity: frame < 96 ? 1 : 0.45 }}>
        <Receipt id="c540e718" width={470} rows={[{ page: "p. 9", title: "Retry the payment on 5xx", rev: "c263a355" }, { page: "p. 10", title: "Payments API: charge", rev: "95077bde" }]} />
        <div style={{ position: "absolute", right: -16, top: -18 }}>
          <Stamp at={26} size={24}>
            Out of date
          </Stamp>
        </div>
      </div>
      <Appear from={96} style={{ position: "absolute", left: 990, top: 370 }}>
        <Receipt id="9f2c41d0" width={470} border={C.ok} rows={[{ page: "p. 11", title: "No automatic retries", rev: "18a4efa9" }, { page: "p. 10", title: "Payments API: charge", rev: "95077bde" }]} />
        <div style={{ position: "absolute", right: -16, top: -18 }}>
          <Stamp at={106} size={24} color={C.ok}>
            Current
          </Stamp>
        </div>
      </Appear>
      <Caption n={7} text="Agents are told when the ground moves." at={8} />
    </Paper>
  );
};

// ── 5. Done is refused on stale work ────────────────────────────────────

export const FRefused: React.FC = () => (
  <Paper>
    <Terminal
      title="Codex"
      width={760}
      height={440}
      style={{ position: "absolute", left: 110, top: 110 }}
      fontSize={17}
      lines={[
        { at: 4, text: "update_plan_item(task, done: true)", color: C.termBlue },
        { at: 22, text: "✗ Not ticked: the context you picked", color: C.termRed },
        { at: 24, text: "  this up with has changed.", color: C.termRed },
        { at: 30, text: "  REPLACED p. 9 → p. 11", color: C.termRed },
        { at: 76, text: "check_context()", color: C.termBlue },
        { at: 92, text: "✓ took p. 11 · receipt 9f2c41d0", color: C.termGreen },
        { at: 108, text: "update_plan_item(task, done: true)", color: C.termBlue },
        { at: 124, text: "✓ Ticked done, against receipt 9f2c41d0", color: C.termGreen },
      ]}
    />
    <div style={{ position: "absolute", left: 990, top: 200 }}>
      <Card width={460}>
        <Label size={12}>Plan · task</Label>
        <div style={{ fontFamily: F.prose, fontSize: 26, color: C.ink, marginTop: 6 }}>Add retry with backoff</div>
        <div style={{ fontFamily: F.body, fontSize: 15, color: C.inkMuted, marginTop: 6 }}>Rests on p. 9 → now p. 11</div>
      </Card>
      <div style={{ position: "absolute", left: 230, top: 96, opacity: interpolate(useCurrentFrame(), [100, 110], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <Stamp at={24} size={30}>
          Refused
        </Stamp>
      </div>
      <div style={{ position: "absolute", left: 250, top: 96 }}>
        <Stamp at={126} size={30} color={C.ok}>
          Done ✓
        </Stamp>
      </div>
    </div>
    <Caption n={8} text={"Stale work can't be called done."} at={8} />
  </Paper>
);

// ── 6. Finished work stays traceable ────────────────────────────────────

export const FTraced: React.FC = () => (
  <Paper>
    <Appear from={4} style={{ position: "absolute", left: 130, top: 110 }}>
      <Card width={560}>
        <Label size={12}>Plan · task · done</Label>
        <div style={{ fontFamily: F.prose, fontSize: 26, color: C.ink, marginTop: 6 }}>Add retry with backoff</div>
        <div style={{ fontFamily: F.body, fontSize: 15, color: C.inkMuted, margin: "6px 0 8px" }}>
          Finished by <b style={{ color: C.pen }}>Codex</b>, against receipt 9f2c41d0
        </div>
        <Row page="p. 11" title="No automatic retries" rev="18a4efa9" />
        <Row page="p. 10" title="Payments API: charge" rev="95077bde" />
        <Appear from={112}>
          <div style={{ borderTop: `1px solid ${C.rule}`, paddingTop: 10, fontFamily: F.body, fontSize: 16, color: C.stamp }}>
            p. 11 was replaced by p. 12 after this was finished. It may need another look.
          </div>
        </Appear>
      </Card>
      <div style={{ position: "absolute", right: -20, top: -20 }}>
        <Stamp at={108} size={28}>
          Review
        </Stamp>
      </div>
    </Appear>
    <GNode at={{ x: 1000, y: 470 }} kind="Task" title="Add retry with backoff" appear={10} />
    <GNode at={{ x: 1000, y: 300 }} kind="Receipt" title="9f2c41d0" appear={18} />
    <GNode at={{ x: 1340, y: 300 }} kind="Note" title="p. 11 No automatic retries" appear={24} tone="retired" />
    <GNode at={{ x: 1340, y: 140 }} kind="Note" title="p. 12 Retry with a key" appear={62} tone="current" />
    <GEdge from={{ x: 1000, y: 470 }} to={{ x: 1000, y: 300 }} draw={16} label="DONE_WITH" labelOffset={{ x: 56, y: 4 }} />
    <GEdge from={{ x: 1000, y: 300 }} to={{ x: 1340, y: 300 }} draw={24} label="DELIVERED" color={C.pen} dashed />
    <GEdge from={{ x: 1340, y: 140 }} to={{ x: 1340, y: 300 }} draw={80} label="REPLACES" color={C.stamp} bold labelOffset={{ x: 52, y: 4 }} />
    <div style={{ position: "absolute", left: 1460, top: 104 }}>
      <Stamp at={74} size={18}>
        Witnessed
      </Stamp>
    </div>
    <Caption n={9} text="Finished work stays traceable." at={8} />
  </Paper>
);

// ── 7. Who knows what, and the keystone decisions ───────────────────────

export const FWho: React.FC = () => {
  const frame = useCurrentFrame();
  const q = "payment retries".slice(0, Math.max(0, Math.floor((frame - 8) / 2)));
  const bars = [
    { page: "p. 12", title: "Retry with an Idempotency-Key", score: 0.41, open: "3 open tasks · Codex working from it" },
    { page: "p. 13", title: "Postgres is the authority", score: 0.22, open: "2 open tasks" },
    { page: "p. 10", title: "Payments API: charge", score: 0.14, open: "1 open task" },
  ];
  return (
    <Paper>
      <Appear from={2} style={{ position: "absolute", left: 130, top: 90 }}>
        <Card width={820}>
          <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <Label size={14} color={C.ink}>
              Who knows what
            </Label>
            <span style={{ fontFamily: F.body, fontSize: 14, color: C.inkMuted }}>From the graph: who wrote each decision, and who was handed which version.</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <div style={{ flex: 1, border: `1px solid ${C.rule}`, padding: "7px 10px", fontFamily: F.body, fontSize: 18, color: C.ink, borderRadius: 2 }}>
              {q}
              <span style={{ opacity: frame % 30 < 16 ? 1 : 0 }}>|</span>
            </div>
            <div style={{ border: `1px solid ${C.rule}`, padding: "7px 14px", fontFamily: F.mono, fontSize: 15, borderRadius: 2 }}>Ask</div>
          </div>
          <Appear from={48}>
            <div style={{ marginTop: 14, fontFamily: F.prose, fontSize: 24, color: C.ink }}>p. 12 “Retry with an Idempotency-Key”</div>
            <div style={{ fontFamily: F.body, fontSize: 15, color: C.inkMuted }}>Replaces p. 11, p. 9 · about lib/checkout/pay.ts</div>
            <div style={{ display: "flex", gap: 22, marginTop: 8, fontFamily: F.body, fontSize: 16.5 }}>
              <span>
                <b style={{ color: C.pen }}>Claude Code</b> wrote it
              </span>
              <span style={{ color: C.stamp }}>
                <b>Codex</b> was handed p. 11, replaced since
              </span>
            </div>
          </Appear>
        </Card>
      </Appear>
      <Appear from={92} style={{ position: "absolute", left: 1010, top: 90 }}>
        <Card width={470}>
          <Label size={13}>Decisions the most work rests on</Label>
          <div style={{ fontFamily: F.mono, fontSize: 12.5, color: C.inkMuted, marginTop: 4 }}>algo.pageRank · DEPENDS_ON</div>
          {bars.map((b, i) => {
            const w = interpolate(frame, [100 + i * 8, 130 + i * 8], [0, b.score / 0.41], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <div key={b.page} style={{ marginTop: 12 }}>
                <div style={{ fontFamily: F.body, fontSize: 15.5, color: C.ink }}>
                  <b style={{ fontFamily: F.display }}>{b.page}</b> {b.title}
                </div>
                <div style={{ height: 8, background: C.paperSunk, marginTop: 5 }}>
                  <div style={{ height: 8, width: `${w * 100}%`, background: i === 0 ? C.cloth : C.pen }} />
                </div>
                <div style={{ fontFamily: F.body, fontSize: 13, color: C.inkMuted, marginTop: 3 }}>{b.open}</div>
              </div>
            );
          })}
        </Card>
      </Appear>
      <Caption n={10} text="Who knows what, and what the most work rests on." at={8} />
    </Paper>
  );
};

// ── 8. Only one agent gets a handoff ────────────────────────────────────

const Racer: React.FC<{ name: string; took: boolean; at: number; good: boolean }> = ({ name, took, at, good }) => {
  const t = useEnter(at, 14);
  const color = took ? (good ? C.ok : C.stamp) : C.inkMuted;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 12px", border: `1.5px solid ${took ? color : C.rule}`, borderRadius: 2, background: C.paper, opacity: 0.3 + 0.7 * t, fontFamily: F.body, fontSize: 16 }}>
      <span style={{ fontFamily: F.mono, fontSize: 14, color: C.ink }}>{name}</span>
      <span style={{ fontFamily: F.display, fontWeight: 700, letterSpacing: "0.12em", fontSize: 13, color, opacity: t }}>{took ? "TOOK IT" : "TAKEN, NOT YOURS"}</span>
    </div>
  );
};

export const FRace: React.FC = () => {
  const before = [true, true, false, true, true, true, false, true];
  const after = [false, false, false, true, false, false, false, false];
  return (
    <Paper>
      <Appear from={2} style={{ position: "absolute", left: 120, right: 120, top: 80, display: "flex", justifyContent: "center" }}>
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 30, color: C.ink }}>Eight agents call pickup_handoff for the same baton, at the same moment.</div>
      </Appear>
      {[
        { title: "LockIn, before", list: before, good: false, x: 240, verdict: "6 agents told they took it", round: "0 / 10 rounds with one winner" },
        { title: "LockIn Manifest", list: after, good: true, x: 880, verdict: "Exactly one took it", round: "10 / 10 rounds with one winner" },
      ].map((side, s) => (
        <div key={side.title} style={{ position: "absolute", left: side.x, top: 160, width: 480 }}>
          <Label size={15} color={s ? C.cloth : C.inkMuted}>
            {side.title}
          </Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            {side.list.map((took, i) => (
              <Racer key={i} name={`agent-${i + 1}`} took={took} at={20 + s * 50 + i * 3} good={side.good} />
            ))}
          </div>
          <Appear from={60 + s * 50}>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 30, letterSpacing: "0.02em", textTransform: "uppercase", color: s ? C.ok : C.stamp, marginTop: 14 }}>{side.verdict}</div>
            <div style={{ fontFamily: F.body, fontSize: 16, color: C.inkMuted }}>{side.round}</div>
          </Appear>
        </div>
      ))}
      <Caption n={11} text="Only one agent gets the handoff." at={8} />
    </Paper>
  );
};

// ── 9. Proof, and the rest ──────────────────────────────────────────────

export const FProof: React.FC = () => {
  const stats = [
    { big: "12 / 12", vs: "vs 5 / 12", what: "Frozen fixtures, same MCP calls, against the original LockIn" },
    { big: "10 / 10", vs: "vs 0 / 10", what: "Rounds with one winner, 8 agents racing" },
    { big: "16 / 16", vs: "", what: "End-to-end checks, on the production Docker stack" },
    { big: "123 ms", vs: "p95", what: "Pickup under contention, through HTTP, Postgres and FalkorDB" },
  ];
  const extras = ["One FalkorDB graph per account", "Claude Code plugin hook", "Docker Compose + GCP deploy", "Graph view of every receipt"];
  return (
    <Paper>
      <div style={{ position: "absolute", left: 140, right: 140, top: 110, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        {stats.map((s, i) => (
          <Appear key={s.big} from={4 + i * 10}>
            <Card width="100%">
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 92, lineHeight: 1, color: C.ink }}>{s.big}</div>
                <div style={{ fontFamily: F.display, fontWeight: 600, fontSize: 32, color: C.inkMuted }}>{s.vs}</div>
              </div>
              <div style={{ fontFamily: F.body, fontSize: 21, color: C.inkMuted, marginTop: 10 }}>{s.what}</div>
            </Card>
          </Appear>
        ))}
      </div>
      <Appear from={56} style={{ position: "absolute", left: 140, right: 140, top: 600, display: "flex", gap: 16, flexWrap: "wrap" }}>
        {extras.map((e) => (
          <div key={e} style={{ fontFamily: F.display, fontWeight: 700, fontSize: 21, letterSpacing: "0.1em", textTransform: "uppercase", color: C.cloth, border: `1.5px solid ${C.cloth}`, padding: "7px 14px", borderRadius: 2, background: C.paper }}>
            {e}
          </div>
        ))}
      </Appear>
      <Caption n={12} text="Tested against the original." at={8} />
    </Paper>
  );
};

export const End: React.FC = () => (
  <Paper>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 44 }}>
      <CoverLabel at={2} scale={0.8} stamp="Manifest" stampAt={14} />
      <Appear from={24}>
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 44, color: C.ink }}>Your agents hand off. The graph keeps the receipts.</div>
      </Appear>
      <Appear from={38} style={{ display: "flex", gap: 14 }}>
        <Label size={18} color={C.ink}>
          github.com/Sky-walkerX/graph-hacks
        </Label>
        <Label size={18}>· Built on FalkorDB</Label>
      </Appear>
    </AbsoluteFill>
  </Paper>
);
