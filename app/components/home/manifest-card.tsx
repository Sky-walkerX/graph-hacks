"use client";

import { useAgo } from "@/app/components/clock";
import { useManifests, type ManifestRow, type OutcomeRow } from "@/hooks/useHandoffs";
import { sourceLabel } from "@/lib/notes/source";

// What each agent working from a baton was handed, and whether it still
// holds. The graph works out a baton's context when an agent takes it and
// keeps a receipt; when a page in it is replaced (and witnessed), edited or
// withdrawn, the receipt here turns out of date and says what changed, until
// the agent takes the new context. Renders nothing until some agent has
// picked up a baton.

type Change = ManifestRow["changes"][number];

const pageOf = (p: { page: number | null; title: string }) => (p.page != null ? `p. ${p.page}` : `"${p.title}"`);

function ChangeLine({ c }: { c: Change }) {
  switch (c.kind) {
    case "replaced":
      return (
        <li>
          <span className="lk-manifest-tag">Replaced</span> {pageOf(c.was)} “{c.was.title}” <span aria-hidden>→</span>{" "}
          <b>{pageOf(c.now)}</b> “{c.now.title}”
          <Path via={c.now.via} then={c.now.replaces ? c.now.replaces.chain.slice(1).map((p) => `p. ${p}`).join(" → ") : pageOf(c.now)} />
        </li>
      );
    case "edited":
      return (
        <li>
          <span className="lk-manifest-tag">Edited</span> {pageOf(c.now)} “{c.now.title}”
        </li>
      );
    case "witnessed":
      return (
        <li>
          <span className="lk-manifest-tag">Witnessed</span> {pageOf(c.now)} “{c.now.title}” now stands
        </li>
      );
    case "withdrawn":
      return (
        <li>
          <span className="lk-manifest-tag">Withdrawn</span> {pageOf(c.was)} “{c.was.title}” was deleted
        </li>
      );
    case "dropped":
      return (
        <li>
          <span className="lk-manifest-tag">Unlinked</span> {pageOf(c.was)} “{c.was.title}”
        </li>
      );
    case "added":
      return (
        <li>
          <span className="lk-manifest-tag">Added</span> {pageOf(c.now)} “{c.now.title}”
          <Path via={c.now.via} />
        </li>
      );
  }
}

/** The path the graph walked, step by step: the baton, its task, the page, and the witnessed replacement that stands for it. */
function Path({ via, then }: { via: Extract<Change, { now: unknown }>["now"]["via"]; then?: string }) {
  return (
    <ol className="lk-manifest-path" aria-label="How the graph reached it">
      {via.map((s, i) => (
        <li key={`${s.id}-${i}`}>
          {s.kind === "Handoff" ? "Baton" : s.kind === "Task" ? `Task “${s.label}”` : s.page != null ? `p. ${s.page}` : `“${s.label}”`}
        </li>
      ))}
      {then ? <li className="lk-manifest-path-then">replaced by {then}</li> : null}
    </ol>
  );
}

function Receipt({ m }: { m: ManifestRow }) {
  const ago = useAgo();
  const stale = m.changes.length > 0;
  return (
    <li className="lk-manifest">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="lk-baton-from">
          <b>{sourceLabel(m.agent)}</b> was handed {m.delivered.length} page{m.delivered.length === 1 ? "" : "s"} {ago(new Date(m.receipt.at))}
          {m.receipt.refreshes > 0 ? <span className="text-muted-foreground"> · refreshed {m.receipt.refreshes}×</span> : null}
        </p>
        <span className={stale ? "lk-manifest-stamp lk-manifest-stamp-stale" : "lk-manifest-stamp"}>
          {stale ? "Out of date" : "Current"}
        </span>
      </div>
      <p className="lk-manifest-goal">{m.baton.goal}</p>
      {stale ? (
        <ul className="lk-manifest-changes">
          {m.changes.map((c, i) => (
            <ChangeLine key={i} c={c} />
          ))}
        </ul>
      ) : null}
      <details className="lk-manifest-evidence">
        <summary>Receipt {m.receipt.id.slice(0, 8)}: what was handed over, and why</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Why it was included</th>
              <th scope="col">Revision</th>
            </tr>
          </thead>
          <tbody>
            {m.delivered.map((d) => (
              <tr key={d.id}>
                <td>
                  {pageOf(d)} “{d.title}”{d.witnessed ? "" : " (not witnessed)"}
                </td>
                <td>{d.why}</td>
                <td>
                  <code>{d.hash.slice(0, 8)}</code>
                  {d.deleted ? " deleted" : d.nowHash !== d.hash ? " edited since" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.receipt.warnings.length > 0 && (
          <ul className="lk-manifest-warnings">
            {m.receipt.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

/** A finished task whose context changed after it was ticked done. */
function AtRisk({ o }: { o: OutcomeRow }) {
  const ago = useAgo();
  return (
    <li className="lk-manifest">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="lk-baton-from">
          <b>{sourceLabel(o.agent)}</b> finished this {ago(new Date(o.at))}, against receipt {o.receipt.slice(0, 8)}
        </p>
        <span className="lk-manifest-stamp lk-manifest-stamp-stale">Review</span>
      </div>
      <p className="lk-manifest-goal">{o.task.title}</p>
      <ul className="lk-manifest-changes">
        {o.changes.map((c, i) => (
          <ChangeLine key={i} c={c} />
        ))}
      </ul>
    </li>
  );
}

export function ManifestCard() {
  const { data } = useManifests();
  if (!data || (data.available && data.manifests.length === 0 && data.atRisk.length === 0)) return null;
  const stale = data.manifests.filter((m) => m.changes.length > 0).length;
  return (
    <section aria-label="Context manifests" className="lk-hero px-4 py-3">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3">
        <h2 className="lk-sec !text-foreground">Context manifests</h2>
        <span className="text-sm text-muted-foreground">
          {!data.available
            ? "The graph can't be reached, so agents' context can't be checked."
            : stale > 0
              ? `${stale} agent${stale === 1 ? " is" : "s are"} working from pages that changed`
              : "Every agent is working from current pages"}
        </span>
      </div>
      {data.manifests.length > 0 && (
        <ul className="grid">
          {data.manifests.map((m) => (
            <Receipt key={m.receipt.id} m={m} />
          ))}
        </ul>
      )}
      {data.atRisk.length > 0 && (
        <>
          <h3 className="lk-manifest-sub">Finished work resting on pages that changed since</h3>
          <ul className="grid">
            {data.atRisk.map((o) => (
              <AtRisk key={`${o.task.id}-${o.receipt}`} o={o} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
