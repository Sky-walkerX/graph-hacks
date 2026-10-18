"use client";

import { useState } from "react";
import { Input } from "@/app/components/ui/input";
import { useBrain } from "@/hooks/useHandoffs";
import { sourceLabel } from "@/lib/notes/source";
import { pageLabel } from "@/lib/notes/page-label";

// The notebook as a team's memory. Ask who knows something (a topic, or a
// file path) and get the pages that stand now and the agents that hold them,
// marking the ones holding a version that's been replaced since. With nothing
// asked, the decisions the most work rests on. Laid out like "Needs a look".
// Renders nothing until the graph has something to say.

const page = (p: { page: number | null; title: string }) => (p.page != null ? `${pageLabel(p.page)} · ${p.title}` : p.title);

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
        <span className="text-sm text-muted-foreground">Who wrote each decision, and which agents hold which version</span>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="A topic (payment retries) or a file (checkout/pay.ts)" aria-label="Topic or file" />
        <button type="submit" className="lk-btn px-3 text-2xs disabled:opacity-50" disabled={!draft.trim() || isFetching}>
          {isFetching ? "Looking" : "Ask"}
        </button>
      </form>

      {q ? (
        data.known.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing in the notebook is about “{q}”.</p>
        ) : (
          <ul className="mt-1 grid">
            {data.known.map((k) => (
              <li key={k.note.id} className="border-t border-border py-1.5 first:border-t-0">
                <span className="font-reading text-base">{page(k.note)}</span>
                {!k.note.witnessed && <span className="lk-stamp ml-2">Awaiting witness</span>}
                <span className="block text-sm text-muted-foreground">
                  {[
                    k.replaced.length > 0 ? `Replaces ${k.replaced.map(pageLabel).join(", ")}` : null,
                    k.files.length > 0 ? `About ${k.files.join(", ")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="block text-sm">
                  {[
                    ...(k.note.source ? [] : [<span key="you">You wrote it</span>]),
                    ...k.knowers.map((w) => (
                      <span key={`${w.agent}-${w.how}`} className={w.current ? undefined : "text-[var(--lk-stamp)]"}>
                        <b className="font-semibold">{sourceLabel(w.agent)}</b>{" "}
                        {w.how === "recorded" ? "wrote it" : w.current ? "was handed it" : `was handed ${w.page != null ? pageLabel(w.page) : "an older page"}, replaced since`}
                      </span>
                    )),
                  ].map((el, i) => (
                    <span key={i}>
                      {i > 0 ? " · " : ""}
                      {el}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <h3 className="lk-sec mt-3">Decisions the most work rests on</h3>
          <ol className="mt-1 grid">
            {data.keystones.map((k) => (
              <li key={k.note.id} className="border-t border-border py-1.5 first:border-t-0">
                <span className="font-reading text-base">{page(k.note)}</span>
                <span className="text-sm text-muted-foreground">
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
