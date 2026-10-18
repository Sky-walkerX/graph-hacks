import { reopened, type Attempt, type Change, type Impact, type Item, type Outcome, type Receipt, type Step } from "./context";
import type { StaleAnswer } from "./ask";
import type { Keystone, Known } from "./brain";

// The manifest, its changes and a note's impact, as an agent reads them in an
// MCP reply. Pure, so it's tested alone.

const page = (p: { page: number | null; title: string }) => (p.page != null ? `p. ${p.page} "${p.title}"` : `"${p.title}"`);

const step = (s: Step) =>
  s.kind === "Note" ? (s.page != null ? `p. ${s.page}` : `note "${s.label}"`) : s.kind === "Handoff" ? "this baton" : `${s.kind.toLowerCase()} "${s.label}"`;

/** How the baton reaches a page: "this baton → task "Add retry" → p. 1". */
export const path = (via: Step[]) => via.map(step).join(" → ");

function line(i: Item): string {
  const why = path(i.via);
  const replaced = i.replaces
    ? ` Stands in for p. ${i.replaces.page} ("${i.replaces.title}"), replaced as witnessed: ${i.replaces.chain.map((p) => `p. ${p}`).join(" → ")}.`
    : "";
  const status = i.witnessed ? "" : " Not witnessed yet.";
  return `- ${page(i)} (note ${i.id}), via ${why}.${replaced}${status}`;
}

function attemptLine(a: Attempt): string {
  const moved = a.premises.filter((p) => p.replacedBy);
  if (moved.length === 0) return `- "${a.text}" (${a.source}). Its premises still stand${a.premises.length ? `: ${a.premises.map((p) => page(p)).join(", ")}` : ""}.`;
  return `- "${a.text}" (${a.source}). Ruled out while ${moved.map((p) => `${page(p)} stood; it has since been replaced by ${page(p.replacedBy!)}`).join(", and ")}. This may be worth retrying.`;
}

/** What was tried and ruled out on this work, newest first. */
export function formatAttempts(attempts: Attempt[]): string {
  if (attempts.length === 0) return "";
  return ["Tried and ruled out before:", ...attempts.map(attemptLine)].join("\n");
}

/** Attempts whose premise moved on, for check_context. */
export function formatReopened(attempts: Attempt[]): string {
  const open = attempts.filter(reopened);
  if (open.length === 0) return "";
  return [`${open.length} attempt${open.length === 1 ? " that was" : "s that were"} ruled out rested on a page that has changed:`, ...open.map(attemptLine)].join("\n");
}

/** The manifest section of a picked-up baton. */
export function formatManifest(receipt: Receipt, attempts: Attempt[] = []): string {
  const lines = [`## Context manifest (receipt ${receipt.id})`];
  if (receipt.items.length === 0) lines.push("The graph links no pages to this baton.");
  else lines.push("The graph found these pages for this work; the pages below are their current text.", ...receipt.items.map(line));
  if (receipt.warnings.length > 0) lines.push("", "Careful:", ...receipt.warnings.map((w) => `- ${w}`));
  if (attempts.length > 0) lines.push("", formatAttempts(attempts));
  lines.push(
    "",
    "Before you tick the task done or leave a baton, call check_context: it says whether any of these pages changed since now.",
  );
  return lines.join("\n");
}

function changeLine(c: Change): string {
  switch (c.kind) {
    case "replaced":
      return `- REPLACED: ${page(c.was)} was replaced by ${page(c.now)} (note ${c.now.id}), now witnessed. Reached via ${path(c.now.via)}.`;
    case "edited":
      return `- EDITED: ${page(c.now)} (note ${c.now.id}) changed since you read it.`;
    case "witnessed":
      return `- WITNESSED: ${page(c.now)} was a proposal when you read it; the user has witnessed it, so it now stands.`;
    case "withdrawn":
      return `- WITHDRAWN: ${page(c.was)} was deleted from the notebook.`;
    case "dropped":
      return `- NO LONGER LINKED: ${page(c.was)} isn't part of this work any more.`;
    case "added":
      return `- ADDED: ${page(c.now)} (note ${c.now.id}) is now part of this work, via ${path(c.now.via)}.`;
  }
}

/** What changed since a receipt. */
export function formatChanges(changes: Change[], since: number): string {
  const at = new Date(since).toISOString().slice(0, 16).replace("T", " ");
  if (changes.length === 0) return `Nothing you were handed at ${at} UTC has changed. Your context is current.`;
  return [`${changes.length} change${changes.length === 1 ? "" : "s"} since you were handed this work at ${at} UTC:`, ...changes.map(changeLine)].join("\n");
}

/** An Ask answer by its question, and its chat when that's named otherwise. */
const asked = (a: { question: string | null; chatTitle: string }) =>
  a.question && !a.chatTitle.startsWith(a.question.slice(0, 40)) ? `"${a.question}" (chat "${a.chatTitle}")` : `"${a.question ?? a.chatTitle}"`;

/** What leans on a note. */
export function formatImpact(impact: Impact): string {
  const lines = [`# What leans on ${page(impact.note)}`];
  if (impact.dependents.length === 0) lines.push("No task, baton or note depends on it in the graph.");
  for (const d of impact.dependents) {
    const what = d.kind === "Handoff" ? `Baton "${d.label}"` : d.kind === "Task" ? `Task "${d.label}"` : `Note "${d.label}"`;
    lines.push(`- ${what}${d.status ? ` (${d.status.toLowerCase().replace("_", " ")})` : ""}: ${d.path.map(step).join(" → ")}`);
  }
  if (impact.told.length > 0) {
    lines.push("", "Agents working from it (or a page that leans on it):");
    for (const t of impact.told) {
      const at = new Date(t.at).toISOString().slice(0, 16).replace("T", " ");
      const what = t.page != null ? `p. ${t.page}` : "it";
      lines.push(`- ${t.agent}: handed ${what} at ${at} UTC (receipt ${t.receipt})${t.stale ? `, replaced since: their context is out of date` : ", still current"}`);
    }
  }
  if (impact.answers.length > 0) {
    lines.push("", `Ask answers that cite it (${impact.answers.length}):`);
    for (const a of impact.answers) lines.push(`- ${asked(a)}, citing p. ${a.page}`);
  }
  return lines.join("\n");
}

/** How tasks were finished, and whether what they rested on still stands. */
export function formatOutcomes(found: Outcome[]): string {
  return found
    .map((o) => {
      const at = new Date(o.at).toISOString().slice(0, 16).replace("T", " ");
      const pages = o.delivered.map((d) => `- ${page(d)}, revision ${d.hash.slice(0, 8)}, via ${d.why}`);
      const verdict =
        o.changes.length === 0
          ? "Everything it rested on still stands."
          : `It may need another look. ${formatChanges(o.changes, o.at).replace(/^.*?:\n/, `${o.changes.length} change${o.changes.length === 1 ? "" : "s"} since it was finished:\n`)}`;
      return [`# Task "${o.task.title}" (task ${o.task.id})`, `Finished by ${o.agent} at ${at} UTC, against receipt ${o.receipt}:`, ...pages, "", verdict].join("\n");
    })
    .join("\n\n");
}

type Doc = { page: number | null; title: string; url: string; citedBy: number };

/** What the notebook knows about a topic or file, and who knows it. */
export function formatKnown(found: Known[], asked: string, docs: Doc[] = []): string {
  if (found.length === 0 && docs.length === 0) return `Nothing in the notebook is about ${asked}.`;
  const saved = docs.length
    ? ["", "Saved documents on it:", ...docs.map((d) => `- ${page(d)}: ${d.url}${d.citedBy ? `, cited by ${d.citedBy} Ask answer${d.citedBy === 1 ? "" : "s"}` : ""}`)]
    : [];
  return found
    .map((k) => {
      const head = `- ${page(k.note)} (note ${k.note.id})${k.note.witnessed ? "" : ", not witnessed yet"}${k.replaced.length ? `, replacing ${k.replaced.map((p) => `p. ${p}`).join(", ")}` : ""}${k.files.length ? `. Files: ${k.files.join(", ")}` : ""}`;
      const who = k.knowers.map((w) =>
        w.how === "recorded"
          ? `  - ${w.agent} wrote it`
          : `  - ${w.agent} was handed ${w.current ? "it" : `p. ${w.page}, since replaced: out of date`}`,
      );
      if (!k.note.source) who.unshift("  - you wrote it");
      if (k.answers.stale) who.push(`  - ${k.answers.stale} Ask answer${k.answers.stale === 1 ? " cites" : "s cite"} a version it replaced: out of date`);
      if (k.answers.current) who.push(`  - ${k.answers.current} Ask answer${k.answers.current === 1 ? " cites" : "s cite"} it`);
      return [head, ...who].join("\n");
    })
    .concat(saved)
    .join("\n")
    .trim();
}

/** Ask answers built on pages the notebook has moved past. */
export function formatStaleAnswers(found: StaleAnswer[]): string {
  if (found.length === 0) return "No Ask answer cites a page that has been replaced or deleted.";
  return [
    `${found.length} Ask answer${found.length === 1 ? " cites" : "s cite"} pages the notebook has moved past. Asking again answers from what stands now:`,
    ...found.map((a) => `- ${asked(a)}: ${a.cited.map((c) => `${page(c)} ${c.now ? `was replaced by ${page(c.now)}` : "was deleted"}`).join("; ")}`),
  ].join("\n");
}

/** The decisions the most work rests on. */
export function formatKeystones(found: Keystone[]): string {
  if (found.length === 0) return "No decision has anything depending on it yet (link_dependency records that).";
  return [
    "Decisions the most work rests on (PageRank over DEPENDS_ON, credited to the page that stands now):",
    ...found.map(
      (k, i) =>
        `${i + 1}. ${page(k.note)} (note ${k.note.id}): score ${k.score.toFixed(3)}, ${k.openWork} open task${k.openWork === 1 ? "" : "s"} or baton${k.openWork === 1 ? "" : "s"}${k.agents.length ? `, agents working from it: ${k.agents.join(", ")}` : ""}`,
    ),
  ].join("\n");
}
