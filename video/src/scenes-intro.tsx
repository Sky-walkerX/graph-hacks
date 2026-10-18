import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Appear, C, Caption, F, Label, NoteCard, Paper, Stamp, Terminal, Wire, useEnter } from "./theme";

// Part one: what LockIn is, for someone who has never seen it. Agents write
// to one notebook over MCP, you witness what they write, and batons hand
// work from one agent to the next. Then the problem the rest of the film
// solves.

/** The notebook's cover label, as on the banner. */
export const CoverLabel: React.FC<{ at?: number; scale?: number; stamp?: string; stampAt?: number }> = ({ at = 0, scale = 1, stamp, stampAt = 30 }) => {
  const t = useEnter(at, 16);
  return (
    <div
      style={{
        position: "relative",
        background: C.label,
        border: "1px solid #d9d4c5",
        borderRadius: 3,
        boxShadow: "0 22px 50px rgba(27,42,47,0.16), 0 2px 4px rgba(27,42,47,0.12)",
        padding: `${30 * scale}px ${60 * scale}px ${26 * scale}px`,
        transform: `scale(${0.94 + 0.06 * t})`,
        opacity: t,
      }}
    >
      <Label size={20 * scale} color={C.inkMuted}>
        Notebook
      </Label>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 200 * scale, lineHeight: 0.92, letterSpacing: "0.02em", color: C.ink }}>LOCKIN</div>
      {stamp ? (
        <div style={{ position: "absolute", right: -40 * scale, bottom: -26 * scale }}>
          <Stamp at={stampAt} size={44 * scale} rotate={-7}>
            {stamp}
          </Stamp>
        </div>
      ) : null}
    </div>
  );
};

/** Fades a scene in and out over its first and last frames. */
export const Scene: React.FC<{ duration: number; children: React.ReactNode }> = ({ duration, children }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, 8, duration - 8, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

export const Title: React.FC = () => (
  <Paper>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 54 }}>
      <CoverLabel at={4} />
      <Appear from={22}>
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 58, color: C.ink }}>The notebook your AI tools write to.</div>
      </Appear>
    </AbsoluteFill>
  </Paper>
);

export const Notebook: React.FC = () => (
  <Paper>
    <Appear from={2} style={{ position: "absolute", left: 120, top: 70 }}>
      <Label size={16}>Monday · Claude Code</Label>
    </Appear>
    <Terminal
      title="Claude Code"
      width={700}
      height={420}
      style={{ position: "absolute", left: 120, top: 104 }}
      lines={[
        { at: 6, text: "● Saving what we decided, so the next session has it.", color: C.termMuted },
        { at: 18, text: "save_note(", color: C.termBlue },
        { at: 24, text: '  title: "Retry the payment on 5xx",', color: C.termGreen },
        { at: 30, text: '  body:  "Retry POST /payments/charge 3×…"', color: C.termGreen },
        { at: 36, text: ")", color: C.termBlue },
        { at: 62, text: "✓ Saved to Checkout · p. 9", color: C.termGreen },
        { at: 66, text: "  waiting for you to witness it", color: C.termMuted },
      ]}
    />
    <Wire x1={820} y1={314} x2={1000} y2={314} at={44} label="MCP" />
    <Appear from={56} style={{ position: "absolute", left: 1000, top: 150 }}>
      <Label size={14} style={{ marginBottom: 10 }}>
        LockIn · Checkout
      </Label>
      <NoteCard page={9} title="Retry the payment on 5xx" body="Retry POST /payments/charge up to 3 times on any 5xx, with backoff." width={470} />
    </Appear>
    <div style={{ position: "absolute", left: 1240, top: 150 }}>
      <Stamp at={74} size={24}>
        Awaiting witness
      </Stamp>
    </div>
    <Caption n={1} text="Your agents write to one notebook, over MCP." at={10} />
  </Paper>
);

export const Witness: React.FC = () => {
  const frame = useCurrentFrame();
  const cx = interpolate(frame, [10, 34], [1180, 628], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cy = interpolate(frame, [10, 34], [620, 336], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ring = interpolate(frame, [38, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const awaiting = interpolate(frame, [40, 46], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Paper>
      <div style={{ position: "absolute", left: 560, top: 150 }}>
        <NoteCard
          page={9}
          title="Retry the payment on 5xx"
          body="Retry POST /payments/charge up to 3 times on any 5xx, with backoff. Implemented in lib/checkout/pay.ts."
          width={560}
        >
          <div style={{ display: "flex", gap: 10, marginTop: 16, borderBottom: `2px solid ${C.pen}`, paddingBottom: 12 }}>
            {["Witness", "Edit", "Ask this note", "Share"].map((b) => (
              <div key={b} style={{ fontFamily: F.display, fontWeight: 700, fontSize: 14, letterSpacing: "0.12em", textTransform: "uppercase", border: `1px solid ${C.ink}`, padding: "4px 10px", borderRadius: 2, background: b === "Witness" && frame > 44 ? C.ink : C.paper, color: b === "Witness" && frame > 44 ? C.paper : C.ink }}>
                {b === "Witness" && frame > 44 ? "Witnessed ✓" : b}
              </div>
            ))}
          </div>
        </NoteCard>
      </div>
      <div style={{ position: "absolute", left: 960, top: 128, opacity: awaiting }}>
        <Stamp at={0} size={24}>
          Awaiting witness
        </Stamp>
      </div>
      <div style={{ position: "absolute", left: 990, top: 118 }}>
        <Stamp at={46} size={34}>
          Witnessed
        </Stamp>
      </div>
      {ring > 0 && ring < 1 ? (
        <div style={{ position: "absolute", left: cx - 24 * ring - 8, top: cy - 24 * ring - 8, width: 16 + 48 * ring, height: 16 + 48 * ring, borderRadius: "50%", border: `4px solid ${C.margin}`, opacity: 1 - ring }} />
      ) : null}
      <svg style={{ position: "absolute", left: cx, top: cy }} width="26" height="34" viewBox="0 0 26 34">
        <path d="M1 1 L1 27 L8 21 L13 32 L18 30 L13 19 L23 19 Z" fill={C.ink} stroke="#fff" strokeWidth="2" />
      </svg>
      <Appear from={60} style={{ position: "absolute", left: 560, top: 560, width: 560 }}>
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 26, color: C.inkMuted }}>Agents record. You sign off on what stands.</div>
      </Appear>
      <Caption n={2} text="Agents record. You witness." at={10} />
    </Paper>
  );
};

/** A baton card, as on the app's home page. */
export const BatonCard: React.FC<{ width?: number }> = ({ width = 430 }) => (
  <div style={{ width, background: C.paper, border: `1px solid ${C.ink}`, boxShadow: "0 10px 26px rgba(27,42,47,0.14)", padding: "14px 18px 16px", borderRadius: 2 }}>
    <Label size={13} color={C.ink}>
      Baton
    </Label>
    <div style={{ fontFamily: F.body, fontSize: 14, color: C.inkMuted, marginTop: 6 }}>
      <b style={{ color: C.pen }}>Claude Code</b> handed this on · acme/shop
    </div>
    <div style={{ fontFamily: F.prose, fontSize: 22, color: C.ink, marginTop: 4 }}>Retry failed checkout payments</div>
    {[
      ["Stands", "Wrapper half-written, no tests yet"],
      ["Next", "Add a test for 3 retries on 503"],
      ["Read", "p. 10 · task “Add retry with backoff”"],
    ].map(([k, v]) => (
      <div key={k} style={{ display: "grid", gridTemplateColumns: "70px 1fr", marginTop: 6, fontSize: 15, fontFamily: F.body, color: C.ink }}>
        <Label size={11}>{k}</Label>
        <div>{v}</div>
      </div>
    ))}
  </div>
);

export const Baton: React.FC = () => (
  <Paper>
    <Terminal
      title="Claude Code · usage cap"
      width={560}
      height={300}
      style={{ position: "absolute", left: 110, top: 120 }}
      fontSize={17}
      lines={[
        { at: 4, text: "● Out of usage. Leaving a baton.", color: C.termMuted },
        { at: 14, text: "save_handoff(", color: C.termBlue },
        { at: 20, text: '  goal: "Retry failed checkout…",', color: C.termGreen },
        { at: 25, text: '  next: "Add a test for 3 retries"', color: C.termGreen },
        { at: 30, text: ")", color: C.termBlue },
        { at: 44, text: "✓ Baton saved", color: C.termGreen },
      ]}
    />
    <Wire x1={670} y1={270} x2={760} y2={270} at={36} />
    <Appear from={46} style={{ position: "absolute", left: 760, top: 150 }}>
      <BatonCard width={400} />
    </Appear>
    <Wire x1={1160} y1={270} x2={1230} y2={270} at={84} />
    <Terminal
      title="Codex · a new session"
      width={300}
      height={300}
      style={{ position: "absolute", left: 1230, top: 120, opacity: useEnter(70) }}
      fontSize={16}
      lines={[
        { at: 76, text: "> carry on", color: C.termInk },
        { at: 90, text: "pickup_handoff()", color: C.termBlue },
        { at: 104, text: "✓ Picked up", color: C.termGreen },
        { at: 110, text: "  Next: add a test", color: C.termMuted },
      ]}
    />
    <Caption n={3} text="Batons hand work from one agent to the next." at={10} />
  </Paper>
);

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const strike = interpolate(frame, [70, 86], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Paper>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 18 }}>
        <Appear from={6}>
          <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 76, color: C.ink }}>A baton is a snapshot.</div>
        </Appear>
        <Appear from={34}>
          <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 76, color: C.stamp }}>Decisions keep moving.</div>
        </Appear>
        <Appear from={60} style={{ marginTop: 34, display: "flex", alignItems: "center", gap: 26 }}>
          <div style={{ position: "relative" }}>
            <NoteCard page={9} title="Retry the payment on 5xx" width={380} retired={strike > 0.5} />
          </div>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 18, letterSpacing: "0.14em", color: C.stamp, opacity: strike }}>REPLACED BY →</div>
          <div style={{ opacity: strike }}>
            <NoteCard page={11} title="No retries: charges aren't idempotent" width={420} />
          </div>
        </Appear>
        <Appear from={96}>
          <div style={{ fontFamily: F.body, fontSize: 26, color: C.inkMuted, marginTop: 16 }}>…and Codex is still implementing retries.</div>
        </Appear>
      </AbsoluteFill>
    </Paper>
  );
};

export const ManifestTitle: React.FC = () => (
  <Paper>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 46 }}>
      <CoverLabel at={2} scale={0.8} stamp="Manifest" stampAt={18} />
      <Appear from={30}>
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 50, color: C.ink, textAlign: "center" }}>Handoffs that know when they went stale.</div>
      </Appear>
      <Appear from={44} style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <Label size={18} color={C.ink}>
          Built on FalkorDB
        </Label>
        <Label size={18}>· Graph Hacks 2026 · Tracks 02 + 03</Label>
      </Appear>
    </AbsoluteFill>
  </Paper>
);
