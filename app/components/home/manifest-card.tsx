"use client";

import { useState } from "react";
import { useAgo } from "@/app/components/clock";
import { ReceiptGraph } from "./receipt-graph";
import { useManifests, type ManifestRow, type OutcomeRow } from "@/hooks/useHandoffs";
import { sourceLabel } from "@/lib/notes/source";
import { pageLabel } from "@/lib/notes/page-label";

// What each agent working from a baton was handed, and whether it still
// holds. The graph works out a baton's context when an agent takes it and
// keeps a receipt; when a page in it is replaced (and witnessed), edited or
// withdrawn, the receipt turns out of date and says what changed, until the
// agent takes the new context. Laid out like the batons above it. Renders
// nothing until some agent has picked up a baton.

type Change = ManifestRow["changes"][number];
type Step = Extract<Change, { now: unknown }>["now"]["via"][number];

const page = (p: { page: number | null; title: string }) => (p.page != null ? `${pageLabel(p.page)} · ${p.title}` : p.title);

/** The path the graph walked, as a line: baton → task "Add retry" → p. 9. */
const path = (via: Step[]) =>
  via.map((s) => (s.kind === "Handoff" ? "baton" : s.kind === "Task" ? `task “${s.label}”` : s.page != null ? pageLabel(s.page) : `“${s.label}”`)).join(" → ");

const WHAT: Record<Change["kind"], string> = {
  replaced: "Replaced",
  edited: "Edited",
  witnessed: "Witnessed",
  withdrawn: "Withdrawn",
  dropped: "Unlinked",
  added: "Added",
};

function Changes({ changes }: { changes: Change[] }) {
  return (
    <dl className="lk-baton-fields">
      {changes.map((c, i) => (
        <div key={i} className="contents">
          <dt>{WHAT[c.kind]}</dt>
          <dd>
            {c.kind === "replaced" ? (
              <>
                {page(c.was)} <span aria-label="by">→</span> <b className="font-semibold">{page(c.now)}</b>
                <span className="block text-sm text-muted-foreground">
                  via {path(c.now.via)}
                  {c.now.replaces && c.now.replaces.chain.length > 2 ? `, then ${c.now.replaces.chain.slice(1).map(pageLabel).join(" → ")}` : ""}
                </span>
              </>
            ) : c.kind === "added" ? (
              <>
                {page(c.now)}
                <span className="block text-sm text-muted-foreground">via {path(c.now.via)}</span>
              </>
            ) : c.kind === "withdrawn" ? (
              <>{page(c.was)}, deleted from the notebook</>
            ) : c.kind === "dropped" ? (
              <>{page(c.was)}, no longer part of this work</>
            ) : c.kind === "witnessed" ? (
              <>{page(c.now)} now stands; it was a proposal when handed over</>
            ) : (
              <>{page(c.now)} changed since it was handed over</>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The receipt's graph, drawn once opened. */
function GraphToggle({ receiptId }: { receiptId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="lk-baton-history" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>The graph behind it</summary>
      {open ? <ReceiptGraph receiptId={receiptId} /> : null}
    </details>
  );
}

function Receipt({ m }: { m: ManifestRow }) {
  const ago = useAgo();
  const stale = m.changes.length > 0;
  return (
    <li className="lk-baton">
      <div className="flex items-start justify-between gap-3">
        <p className="lk-baton-from">
          <b>{sourceLabel(m.agent)}</b> was handed {m.delivered.length} page{m.delivered.length === 1 ? "" : "s"} {ago(new Date(m.receipt.at))}
          <span className="text-muted-foreground">
            {" "}
            · receipt {m.receipt.id.slice(0, 8)}
            {m.receipt.refreshes > 0 ? ` · refreshed ${m.receipt.refreshes}×` : ""}
          </span>
        </p>
        {stale ? <span className="lk-stamp">Out of date</span> : <span className="lk-tag">Current</span>}
      </div>
      <p className="lk-baton-goal">{m.baton.goal}</p>
      {stale ? <Changes changes={m.changes} /> : null}
      <GraphToggle receiptId={m.receipt.id} />
      <details className="lk-baton-history">
        <summary>What was handed over, and why</summary>
        <ul>
          {m.delivered.map((d) => (
            <li key={d.id}>
              <span className="font-reading">{page(d)}</span>
              <span className="text-muted-foreground"> · via {d.why}</span>{" "}
              <span className="lk-tag" title="The page's revision when it was handed over">
                {d.hash.slice(0, 8)}
              </span>
              {d.deleted ? <span className="text-muted-foreground"> · deleted since</span> : d.nowHash !== d.hash ? <span className="text-muted-foreground"> · edited since</span> : null}
              {d.witnessed ? null : <span className="text-muted-foreground"> · not witnessed when handed over</span>}
            </li>
          ))}
        </ul>
        {m.receipt.warnings.length > 0 && (
          <ul className="mt-1.5">
            {m.receipt.warnings.map((w) => (
              <li key={w} className="text-muted-foreground">
                {w}
              </li>
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
    <li className="lk-baton">
      <div className="flex items-start justify-between gap-3">
        <p className="lk-baton-from">
          <b>{sourceLabel(o.agent)}</b> finished this {ago(new Date(o.at))}
          <span className="text-muted-foreground"> · against receipt {o.receipt.slice(0, 8)}</span>
        </p>
        <span className="lk-stamp">Review</span>
      </div>
      <p className="lk-baton-goal">{o.task.title}</p>
      <Changes changes={o.changes} />
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
            ? "The graph can't be reached, so agents' context can't be checked"
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
          <h3 className="lk-sec mt-2 border-t border-border pt-2.5">Finished work to look at again</h3>
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
