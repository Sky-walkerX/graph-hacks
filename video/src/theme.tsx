import React, { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// The Lab Notebook look (see ../DESIGN.md): grid paper with a red margin rule,
// a cloth-green spine, blue-black ink, condensed caps for labels, Spectral for
// reading, JetBrains Mono for terminals, and red stamps. The fonts are the
// app's own files.

export const C = {
  ink: "#1b2a2f",
  inkMuted: "#5a6b71",
  paper: "#ffffff",
  paperSunk: "#f2f6f4",
  label: "#f7f5ee",
  rule: "#d5dfdc",
  grid: "rgba(36, 69, 59, 0.10)",
  gridMajor: "rgba(36, 69, 59, 0.20)",
  cloth: "#24453b",
  clothInk: "#eef0e8",
  pen: "#2f5fa0",
  margin: "#d2453a",
  stamp: "#b4372d",
  ok: "#2e7d4f",
  warn: "#a35a12",
  term: "#131c1e",
  termBar: "#1c2729",
  termInk: "#dbe5e2",
  termMuted: "#7f9491",
  termBlue: "#7fa8e8",
  termGreen: "#8fcf9d",
  termRed: "#e98479",
};

export const F = {
  display: "'Barlow Condensed', 'Arial Narrow', sans-serif",
  body: "Barlow, 'Helvetica Neue', Arial, sans-serif",
  prose: "Spectral, Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

const FONTS: [string, string, string, string][] = [
  ["Barlow Condensed", "barlow-condensed-latin-500.woff2", "500", "normal"],
  ["Barlow Condensed", "barlow-condensed-latin-600.woff2", "600", "normal"],
  ["Barlow Condensed", "barlow-condensed-latin-700.woff2", "700", "normal"],
  ["Barlow", "barlow-latin-400.woff2", "400", "normal"],
  ["Barlow", "barlow-latin-500.woff2", "500", "normal"],
  ["Barlow", "barlow-latin-600.woff2", "600", "normal"],
  ["JetBrains Mono", "jetbrains-mono-latin-100-800.woff2", "100 800", "normal"],
  ["Spectral", "spectral-latin-400.woff2", "400", "normal"],
  ["Spectral", "spectral-latin-500.woff2", "500", "normal"],
  ["Spectral", "spectral-latin-600.woff2", "600", "normal"],
  ["Spectral", "spectral-latin-400-italic.woff2", "400", "italic"],
  ["Spectral", "spectral-latin-500-italic.woff2", "500", "italic"],
];

/** Holds the render until the notebook's fonts have loaded. */
export function useFonts() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(
      FONTS.map(([family, file, weight, style]) => {
        const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight, style });
        document.fonts.add(face);
        return face.load();
      }),
    ).then(() => continueRender(handle));
  }, [handle]);
}

/** Grid paper with the red margin rule, as on the app's list pages. */
export const Paper: React.FC<{ children?: React.ReactNode; margin?: number }> = ({ children, margin = 64 }) => (
  <AbsoluteFill
    style={{
      backgroundColor: C.paper,
      backgroundImage: [
        `linear-gradient(${C.gridMajor} 1px, transparent 1px)`,
        `linear-gradient(90deg, ${C.gridMajor} 1px, transparent 1px)`,
        `linear-gradient(${C.grid} 1px, transparent 1px)`,
        `linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
      ].join(","),
      backgroundSize: "100px 100px, 100px 100px, 20px 20px, 20px 20px",
    }}
  >
    <div style={{ position: "absolute", left: margin, top: 0, bottom: 0, width: 2, background: C.margin, opacity: 0.85 }} />
    {children}
  </AbsoluteFill>
);

/** Condensed caps, the notebook's printed labels. */
export const Label: React.FC<{ children: React.ReactNode; color?: string; size?: number; style?: React.CSSProperties }> = ({
  children,
  color = C.inkMuted,
  size = 15,
  style,
}) => (
  <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: size, letterSpacing: "0.16em", textTransform: "uppercase", color, ...style }}>
    {children}
  </div>
);

/** A spring from 0 to 1 starting at `from`. */
export function useEnter(from: number, damping = 18) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - from, fps, config: { damping, mass: 0.7 } });
}

/** Linear 0..1 between two frames, clamped. */
export function useProgress(from: number, to: number) {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

/** Rises and fades in from `from`. */
export const Appear: React.FC<{ from: number; children: React.ReactNode; y?: number; style?: React.CSSProperties }> = ({ from, children, y = 18, style }) => {
  const t = useEnter(from);
  return <div style={{ opacity: t, transform: `translateY(${(1 - t) * y}px)`, ...style }}>{children}</div>;
};

export type Line = { at: number; text: React.ReactNode; color?: string; indent?: number; type?: boolean };

/** A terminal window like the app's film: title bar, then lines that appear (or type) at their frames. */
export const Terminal: React.FC<{
  title: string;
  lines: Line[];
  width: number;
  height: number;
  style?: React.CSSProperties;
  fontSize?: number;
}> = ({ title, lines, width, height, style, fontSize = 19 }) => {
  const frame = useCurrentFrame();
  const shown = lines.filter((l) => frame >= l.at);
  const last = shown[shown.length - 1];
  return (
    <div
      style={{
        width,
        height,
        background: C.term,
        borderRadius: 6,
        boxShadow: "0 18px 40px rgba(17, 26, 27, 0.28), 0 2px 6px rgba(17,26,27,0.2)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ height: 34, background: C.termBar, display: "flex", alignItems: "center", gap: 8, padding: "0 14px" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 9, height: 9, borderRadius: 9, background: "#3a4a4c" }} />
        ))}
        <Label color={C.termMuted} size={12} style={{ marginLeft: 14 }}>
          {title}
        </Label>
      </div>
      <div style={{ padding: "18px 22px", fontFamily: F.mono, fontSize, lineHeight: 1.62, color: C.termInk }}>
        {shown.map((l, i) => {
          const typed = l.type && typeof l.text === "string" ? (l.text as string).slice(0, Math.max(0, Math.floor((frame - l.at) * 1.6))) : l.text;
          return (
            <div key={i} style={{ color: l.color ?? C.termInk, paddingLeft: (l.indent ?? 0) * 20, whiteSpace: "pre" }}>
              {typed}
              {l === last && frame % 30 < 18 ? <span style={{ display: "inline-block", width: 10, height: fontSize, background: C.termInk, marginLeft: 3, verticalAlign: "-3px" }} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** A red rubber stamp, slammed in at `at`. */
export const Stamp: React.FC<{ at: number; children: React.ReactNode; color?: string; rotate?: number; size?: number; style?: React.CSSProperties }> = ({
  at,
  children,
  color = C.stamp,
  rotate = -8,
  size = 22,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < at) return null;
  const t = spring({ frame: frame - at, fps, config: { damping: 11, mass: 0.5, stiffness: 220 } });
  const scale = interpolate(t, [0, 1], [1.8, 1]);
  return (
    <div
      style={{
        display: "inline-block",
        fontFamily: F.display,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        border: `3px solid ${color}`,
        borderRadius: 3,
        padding: "2px 12px",
        transform: `rotate(${rotate}deg) scale(${scale})`,
        opacity: Math.min(1, t * 1.4),
        background: "rgba(255,255,255,0.6)",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** A notebook page card: the label line, the title in Spectral, who recorded it. */
export const NoteCard: React.FC<{
  page: number;
  title: string;
  by?: string;
  body?: string;
  width?: number;
  retired?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ page, title, by = "Claude Code", body, width = 420, retired, style, children }) => (
  <div
    style={{
      width,
      background: C.paper,
      border: `1px solid ${C.rule}`,
      borderRadius: 2,
      boxShadow: "0 8px 24px rgba(27,42,47,0.10)",
      padding: "16px 20px 18px",
      opacity: retired ? 0.5 : 1,
      position: "relative",
      ...style,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 8, height: 14, background: C.pen }} />
      <Label size={12}>Checkout · note · p. {page}</Label>
    </div>
    <div style={{ fontFamily: F.prose, fontWeight: 600, fontSize: 25, lineHeight: 1.18, color: C.ink, marginTop: 8, textDecoration: retired ? "line-through" : "none" }}>{title}</div>
    <div style={{ fontFamily: F.body, fontSize: 14, color: C.inkMuted, marginTop: 6 }}>
      Recorded by <b style={{ color: C.ink }}>{by}</b>
    </div>
    {body ? <div style={{ fontFamily: F.prose, fontSize: 16.5, lineHeight: 1.5, color: C.ink, marginTop: 10 }}>{body}</div> : null}
    {children}
  </div>
);

/** The caption bar at the bottom of each scene: "ENTRY 03 | WHAT HAPPENS". */
export const Caption: React.FC<{ n: number; text: string; at?: number }> = ({ n, text, at = 6 }) => {
  const t = useEnter(at, 20);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        bottom: 46,
        background: C.label,
        border: `1px solid ${C.rule}`,
        boxShadow: "0 10px 26px rgba(27,42,47,0.14)",
        borderRadius: 2,
        display: "flex",
        alignItems: "center",
        gap: 26,
        padding: "16px 28px",
        opacity: t,
        transform: `translateY(${(1 - t) * 30}px)`,
      }}
    >
      <div style={{ borderRight: `1px solid ${C.rule}`, paddingRight: 24 }}>
        <Label size={12}>Entry</Label>
        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 36, lineHeight: 1, color: C.stamp }}>{String(n).padStart(2, "0")}</div>
      </div>
      <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 40, letterSpacing: "0.02em", textTransform: "uppercase", color: C.ink }}>{text}</div>
    </div>
  );
};

/** A dashed connector labelled like the film's "MCP" tags. */
export const Wire: React.FC<{ x1: number; y1: number; x2: number; y2: number; at: number; label?: string; color?: string; dashed?: boolean; width?: number }> = ({
  x1,
  y1,
  x2,
  y2,
  at,
  label,
  color = C.pen,
  dashed = true,
  width = 2,
}) => {
  const p = useProgress(at, at + 18);
  if (p <= 0) return null;
  const x = x1 + (x2 - x1) * p;
  const y = y1 + (y2 - y1) * p;
  return (
    <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} width="100%" height="100%">
      <line x1={x1} y1={y1} x2={x} y2={y} stroke={color} strokeWidth={width} strokeDasharray={dashed ? "6 6" : undefined} />
      <circle cx={x1} cy={y1} r={5} fill="#fff" stroke={color} strokeWidth={2} />
      {p >= 1 ? <circle cx={x2} cy={y2} r={5} fill="#fff" stroke={color} strokeWidth={2} /> : null}
      {label && p > 0.5 ? (
        <foreignObject x={(x1 + x2) / 2 - 40} y={(y1 + y2) / 2 - 30} width={80} height={26}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 12, letterSpacing: "0.14em", color, background: "#eef3fa", border: `1px solid ${color}55`, padding: "2px 8px", borderRadius: 2 }}>{label}</div>
          </div>
        </foreignObject>
      ) : null}
    </svg>
  );
};
