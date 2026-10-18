"use client";

import { useState } from "react";
import { useBrain } from "@/hooks/useHandoffs";
import { sourceLabel } from "@/lib/notes/source";

// The notebook as a team's memory. Ask who knows something (a topic, or a
// file path) and get the pages that stand now and the agents that hold them,
// marking the ones holding a version that's been replaced since. With nothing
// asked, the decisions the most work rests on. Renders nothing until the
// graph has something to say.

const pageOf = (p: { page: number | null; title: string }) => (p.page != null ? `p. ${p.page}` : `"${p.title}"`);

export function BrainCard() {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const { data, isFetching } = useBrain(q);
  if (!data?.available) return null;
  if (!q && data.keystones.length === 0) return null;
  return (
    <section aria-label="Who knows what" className="lk-hero px-4 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 className="lk-sec !text-foreground">Who knows what</h2>
        <span className="text-sm text-muted-foreground">From the graph: who wrote each decision, and who was handed which version.</span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <input
          className="lk-brain-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="A topic (payment retries) or a file (checkout/pay.ts)"
          aria-label="Topic or file"
        />
        <button type="submit" className="lk-baton-cmd">
          {isFetching ? "Looking…" : "Ask"}
        </button>
        {q ? (
          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setQ("");
              setDraft("");
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {q ? (
        data.known.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing in the notebook is about “{q}”.</p>
        ) : (
          <ul className="mt-2 grid">
            {data.known.map((k) => (
              <li key={k.note.id} className="lk-manifest">
                <p className="lk-manifest-goal">
                  {pageOf(k.note)} “{k.note.title}”
                </p>
                <p className="text-sm text-muted-foreground">
                  {k.replaced.length > 0 ? `Replaces ${k.replaced.map((p) => `p. ${p}`).join(", ")}. ` : ""}
                  {k.files.length > 0 ? `About ${k.files.join(", ")}.` : ""}
                  {k.note.witnessed ? "" : " Not witnessed yet."}
                </p>
                <ul className="lk-brain-knowers">
                  {!k.note.source && <li>You wrote it</li>}
                  {k.knowers.map((w) => (
                    <li key={`${w.agent}-${w.how}`} className={w.current ? "" : "lk-brain-stale"}>
                      <b>{sourceLabel(w.agent)}</b> {w.how === "recorded" ? "wrote it" : w.current ? "was handed it" : `was handed p. ${w.page}, replaced since`}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <h3 className="lk-manifest-sub">Decisions the most work rests on</h3>
          <ol className="mt-1 grid gap-1.5 text-[14.5px]">
            {data.keystones.map((k) => (
              <li key={k.note.id}>
                <b>{pageOf(k.note)}</b> “{k.note.title}”
                <span className="text-muted-foreground">
                  {" "}
                  · {k.openWork} open task{k.openWork === 1 ? "" : "s"} or baton{k.openWork === 1 ? "" : "s"}
                  {k.agents.length ? ` · ${k.agents.map(sourceLabel).join(", ")} working from it` : ""}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
