import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import timeline from "./demo-timeline.json";
import { Baton, CoverLabel, Notebook, Scene } from "./scenes-intro";
import { End, FProof } from "./scenes-features";
import { Appear, C, F, Label, Paper, useFonts } from "./theme";

// The demo video: a real run of two local agents working through LockIn's
// MCP tools, cut beside a recording of the app, under narration. The
// timeline (src/demo-timeline.json) comes from video/demo/prep.mjs: which
// stretch of the recording plays when, at what speed, and when each agent
// event appears. Nothing on the terminals is written by hand.

type Ev = { frame: number; agent: string; type: string; text?: string; tool?: string; args?: Record<string, unknown>; isError?: boolean };
type Clip = { start: number; end: number; atFrame: number; frames: number };
type SceneT = { kind: string; label?: string; voice: string; from: number; frames: number; voiceAt: number; clips?: Clip[]; events?: Ev[]; speedup?: number };

const SCENES = timeline.scenes as SceneT[];
export const DEMO_FRAMES = timeline.frames;

const TITLES: Record<string, string> = {
  decide: "An agent records a decision. You witness it.",
  handoff: "It plans the work, and leaves a baton.",
  pickup: "The next agent picks up through the graph, with a receipt.",
  change: "The decision changes. The receipt goes out of date.",
  refused: "Stale work can't be called done.",
  traced: "Finished work stays traceable.",
  who: "Who knows what.",
};

/** 1600×900 scenes from the product film, scaled up to the 1920×1080 frame. */
const Scaled: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill>
    <div style={{ width: 1600, height: 900, transform: "scale(1.2)", transformOrigin: "top left", position: "relative" }}>{children}</div>
  </AbsoluteFill>
);

const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 38 ? `${s.slice(0, 37)}…` : s;
};

/** One agent's terminal, replaying its real events up to the current frame. */
const AgentTerminal: React.FC<{ name: string; title: string; events: Ev[]; height: number }> = ({ name, title, events, height }) => {
  const frame = useCurrentFrame();
  const lines: { text: string; color: string }[] = [];
  for (const e of events.filter((x) => x.agent === name && x.frame <= frame)) {
    if (e.type === "thought" && e.text) lines.push({ text: `● ${e.text}`, color: C.termMuted });
    if (e.type === "call") {
      lines.push({ text: `${e.tool}(`, color: C.termBlue });
      for (const [k, v] of Object.entries(e.args ?? {}).slice(0, 4)) lines.push({ text: `  ${k}: ${short(v)}`, color: C.termGreen });
      lines.push({ text: ")", color: C.termBlue });
    }
    if (e.type === "result" && e.text) {
      const [first, ...rest] = e.text.split("\n").filter((l) => l.trim());
      lines.push({ text: `${e.isError ? "✗" : "✓"} ${first}`, color: e.isError ? C.termRed : C.termGreen });
      for (const l of rest.slice(0, e.isError ? 3 : 2)) lines.push({ text: `  ${l}`, color: e.isError ? C.termRed : C.termMuted });
    }
  }
  const active = events.some((x) => x.agent === name && Math.abs(x.frame - frame) < 20);
  const shown = lines.slice(-Math.floor((height - 60) / 25));
  return (
    <div
      style={{
        height,
        background: C.term,
        borderRadius: 6,
        overflow: "hidden",
        boxShadow: "0 14px 34px rgba(17,26,27,0.26)",
        outline: active ? `2px solid ${C.termBlue}` : "none",
      }}
    >
      <div style={{ height: 34, background: C.termBar, display: "flex", alignItems: "center", gap: 8, padding: "0 14px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 9, height: 9, borderRadius: 9, background: "#3a4a4c" }} />
        ))}
        <Label color={C.termMuted} size={12} style={{ marginLeft: 12 }}>
          {title}
        </Label>
      </div>
      <div style={{ padding: "12px 18px", fontFamily: F.mono, fontSize: 16, lineHeight: "25px", color: C.termInk }}>
        {shown.map((l, i) => (
          <div key={i} style={{ color: l.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
};

/** The recorded app, in a plain browser frame. */
const Browser: React.FC<{ clips: Clip[] }> = ({ clips }) => (
  <div style={{ width: 1120, borderRadius: 6, overflow: "hidden", boxShadow: "0 18px 44px rgba(17,26,27,0.22)", border: `1px solid ${C.rule}`, background: C.paper }}>
    <div style={{ height: 36, background: C.paperSunk, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderBottom: `1px solid ${C.rule}` }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ width: 10, height: 10, borderRadius: 10, background: C.rule }} />
      ))}
      <div style={{ marginLeft: 12, flex: 1, background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 4, padding: "3px 12px", fontFamily: F.body, fontSize: 14, color: C.inkMuted }}>
        localhost:3005 · LockIn
      </div>
    </div>
    <div style={{ position: "relative", width: 1120, height: 700 }}>
      {clips.map((c, i) => (
        <Sequence key={i} from={c.atFrame} durationInFrames={c.frames} layout="none">
          <OffthreadVideo
            src={staticFile("demo/browser.webm")}
            startFrom={Math.round(c.start * 30)}
            playbackRate={Math.max(0.25, (c.end - c.start) / (c.frames / 30))}
            muted
            style={{ position: "absolute", inset: 0, width: 1120, height: 700 }}
          />
        </Sequence>
      ))}
    </div>
  </div>
);

const ChapterScene: React.FC<{ s: SceneT; n: number }> = ({ s, n }) => (
  <Paper margin={36}>
    <div style={{ position: "absolute", left: 72, top: 56, width: 640, display: "grid", gap: 18 }}>
      <AgentTerminal name="agent-a" title="Agent A · Qwen2.5-3B, local" events={s.events ?? []} height={398} />
      <AgentTerminal name="agent-b" title="Agent B · Qwen2.5-3B, local" events={s.events ?? []} height={398} />
    </div>
    <div style={{ position: "absolute", left: 740, top: 56 }}>
      <Browser clips={s.clips ?? []} />
    </div>
    <div style={{ position: "absolute", left: 740, top: 812, display: "flex", gap: 10, alignItems: "center" }}>
      <Label size={13} color={C.cloth}>
        Live run
      </Label>
      <Label size={13}>· real tool calls · model thinking time sped up</Label>
    </div>
    <Appear from={4} style={{ position: "absolute", left: 72, right: 72, bottom: 40 }}>
      <div style={{ background: C.label, border: `1px solid ${C.rule}`, boxShadow: "0 10px 26px rgba(27,42,47,0.14)", borderRadius: 2, display: "flex", alignItems: "center", gap: 26, padding: "14px 28px" }}>
        <div style={{ borderRight: `1px solid ${C.rule}`, paddingRight: 24 }}>
          <Label size={12}>Step</Label>
          <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 36, lineHeight: 1, color: C.stamp }}>{String(n).padStart(2, "0")}</div>
        </div>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 38, letterSpacing: "0.02em", textTransform: "uppercase", color: C.ink }}>{TITLES[s.label ?? ""] ?? s.label}</div>
      </div>
    </Appear>
  </Paper>
);

const OpenScene: React.FC = () => (
  <Paper>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 54 }}>
      <CoverLabel at={2} scale={1} stamp="Manifest" stampAt={22} />
      <Appear from={30}>
        <div style={{ fontFamily: F.prose, fontStyle: "italic", fontSize: 60, color: C.ink }}>Handoffs that know when they went stale.</div>
      </Appear>
      <Appear from={46}>
        <Label size={22} color={C.ink}>
          Built on FalkorDB · Graph Hacks 2026 · Tracks 02 + 03
        </Label>
      </Appear>
    </AbsoluteFill>
  </Paper>
);

/** LockIn in two beats, from the product film: agents write, batons hand work on. */
const LockinScene: React.FC<{ frames: number }> = ({ frames }) => {
  const half = Math.floor(frames / 2);
  return (
    <>
      <Sequence durationInFrames={half}>
        <Scaled>
          <Notebook />
        </Scaled>
      </Sequence>
      <Sequence from={half}>
        <Scaled>
          <Baton />
        </Scaled>
      </Sequence>
    </>
  );
};

const RealScene: React.FC = () => (
  <Paper>
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 1180, background: C.paper, border: `1px solid ${C.rule}`, boxShadow: "0 18px 44px rgba(27,42,47,0.14)", padding: "40px 52px" }}>
        <Label size={18} color={C.stamp}>
          What you're about to see
        </Label>
        <div style={{ fontFamily: F.prose, fontSize: 44, lineHeight: 1.25, color: C.ink, marginTop: 14 }}>A real run, end to end.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 40px", marginTop: 28, fontFamily: F.body, fontSize: 24, color: C.ink }}>
          {[
            ["Agents", "Two local agents: Qwen2.5-3B (Q4) on 4 CPU cores, via llama.cpp"],
            ["Tools", "LockIn's MCP server, each agent with its own token"],
            ["Graph", "FalkorDB 4.22, one graph per account"],
            ["Edit", "Model thinking time sped up; tool calls and replies are real"],
          ].map(([k, v]) => (
            <div key={k}>
              <Label size={14}>{k}</Label>
              <div style={{ marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  </Paper>
);

export const Demo: React.FC = () => {
  useFonts();
  let chapter = 0;
  return (
    <Paper>
      {SCENES.map((s, i) => {
        if (s.kind === "chapter") chapter++;
        const n = chapter;
        return (
          <Sequence key={i} from={s.from} durationInFrames={s.frames}>
            <Scene duration={s.frames}>
              {s.kind === "open" ? <OpenScene /> : null}
              {s.kind === "lockin" ? <LockinScene frames={s.frames} /> : null}
              {s.kind === "real" ? <RealScene /> : null}
              {s.kind === "chapter" ? <ChapterScene s={s} n={n} /> : null}
              {s.kind === "proof" ? (
                <Scaled>
                  <FProof />
                </Scaled>
              ) : null}
              {s.kind === "close" ? (
                <Scaled>
                  <End />
                </Scaled>
              ) : null}
            </Scene>
            <Sequence from={s.voiceAt} layout="none">
              <Audio src={staticFile(`demo/voice/${s.voice}.wav`)} />
            </Sequence>
          </Sequence>
        );
      })}
    </Paper>
  );
};
