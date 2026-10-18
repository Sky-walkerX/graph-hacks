// Turns a demo run (events.json + browser.webm) and the narration clips into
// the film's timeline: src/demo-timeline.json, read by src/Demo.tsx.
//
//   node video/demo/prep.mjs <run dir> <voice dir>
//
// Each chapter of the run becomes a scene as long as its narration. Inside a
// chapter, time is warped: the stretches where an agent is waiting on the
// model are squeezed hard, while what the user does (and the app redrawing
// after it) plays at close to real speed. The film labels the squeeze.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const [runDir, voiceDir] = process.argv.slice(2);
const FPS = 30;
const here = new URL(".", import.meta.url).pathname;
const pub = join(here, "../public/demo");
mkdirSync(join(pub, "voice"), { recursive: true });

const events = JSON.parse(readFileSync(join(runDir, "events.json"), "utf8"));
const narration = JSON.parse(readFileSync(join(here, "narration.json"), "utf8"));
copyFileSync(join(runDir, "browser.webm"), join(pub, "browser.webm"));

const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
const voice = {};
for (const n of narration) {
  const src = join(voiceDir, `${n.id}.wav`);
  copyFileSync(src, join(pub, "voice", `${n.id}.wav`));
  voice[n.id] = seconds(src);
}

const chapters = events.filter((e) => e.type === "chapter" || e.type === "end");
const LEAD = 0.4; // seconds of picture before the voice starts
const TAIL = 0.8; // and after it ends

/** The pieces of a chapter's window: real time in, film time out. */
function warp(from, to) {
  const inside = events.filter((e) => e.t > from && e.t <= to && e.type !== "chapter");
  const pieces = [];
  let at = from;
  for (const e of inside) {
    const gap = (e.t - at) / 1000;
    if (gap > 0) {
      // A gap that ends in a user action is the action itself: keep it near real time.
      const out = e.type === "user" ? Math.min(gap, 4.5) : e.type === "thought" ? Math.min(gap, 1.1) : Math.min(gap, 0.6);
      pieces.push({ from: at / 1000, to: e.t / 1000, out });
    }
    at = e.t;
  }
  if (to > at) pieces.push({ from: at / 1000, to: to / 1000, out: Math.min((to - at) / 1000, 2.5) });
  return pieces;
}

const scenes = [];
const add = (scene) => scenes.push(scene);
add({ kind: "open", voice: "open" });
add({ kind: "lockin", voice: "lockin" });
add({ kind: "real", voice: "real" });
for (let i = 0; i < chapters.length - 1; i++) {
  const c = chapters[i];
  const end = chapters[i + 1].t;
  const pieces = warp(c.t, end);
  const natural = pieces.reduce((s, p) => s + p.out, 0);
  const want = voice[c.label] + LEAD + TAIL;
  // Fit the warped chapter to its narration: stretch it, or squeeze it, but
  // never so much that a click is hard to follow; then the picture runs on
  // a little after the voice.
  const k = Math.max(want / natural, 0.75);
  let cursor = 0;
  const clips = pieces.map((p) => {
    const out = p.out * k;
    const clip = { start: p.from, end: p.to, at: cursor, dur: out };
    cursor += out;
    return clip;
  });
  // Where each event lands in the film.
  const lands = (t) => {
    for (const cl of clips) if (t / 1000 >= cl.start && t / 1000 <= cl.end) return cl.at + ((t / 1000 - cl.start) / Math.max(cl.end - cl.start, 1e-6)) * cl.dur;
    return cursor;
  };
  const evs = events
    .filter((e) => e.t > c.t && e.t <= end && e.agent)
    .map((e) => ({ ...e, film: lands(e.t) }));
  const speedup = (end - c.t) / 1000 / cursor;
  add({ kind: "chapter", label: c.label, voice: c.label, seconds: cursor, clips, events: evs, speedup });
}
add({ kind: "proof", voice: "proof" });
add({ kind: "close", voice: "close" });

let frame = 0;
for (const s of scenes) {
  const dur = s.seconds ?? voice[s.voice] + LEAD + TAIL;
  s.from = frame;
  s.frames = Math.round(dur * FPS);
  s.voiceAt = Math.round(LEAD * FPS);
  if (s.clips) for (const c of s.clips) Object.assign(c, { atFrame: Math.round(c.at * FPS), frames: Math.max(1, Math.round(c.dur * FPS)) });
  if (s.events) for (const e of s.events) e.frame = Math.round(e.film * FPS);
  frame += s.frames;
}
writeFileSync(join(here, "../src/demo-timeline.json"), JSON.stringify({ fps: FPS, frames: frame, scenes }, null, 1));
console.log(`${scenes.length} scenes, ${(frame / FPS).toFixed(1)} s`);
for (const s of scenes) console.log(`  ${s.kind.padEnd(8)} ${(s.label ?? "").padEnd(9)} ${(s.frames / FPS).toFixed(1)} s${s.speedup ? `  (×${s.speedup.toFixed(1)})` : ""}`);
