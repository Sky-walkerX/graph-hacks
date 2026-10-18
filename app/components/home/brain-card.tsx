"use client";

import { useState } from "react";
import { Input } from "@/app/components/ui/input";
import { useBrain } from "@/hooks/useHandoffs";
import { sourceLabel } from "@/lib/notes/source";
import { pageLabel } from "@/lib/notes/page-label";

// The notebook as a team's memory. Ask who knows something (a topic, or a
// file path) and get the pages that stand now and the agents that hold them,
// marking the ones holding a version that's been replaced since, and the
// saved documents on it. With nothing asked, the decisions the most work
// rests on, and the Ask answers that cite pages replaced since. Laid out like
// "Needs a look".
// Renders nothing until the graph has something to say.

const page = (p: { page: number | null; title: string }) => (p.page != null ? `${pageLabel(p.page)} · ${p.title}` : p.title);

export function BrainCard() {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const { data, isFetching } = useBrain(q);
  if (!data?.available) return null;
  if (!q && data.keystones.length === 0 && data.reask.length === 0) return null;
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
        data.known.length === 0 && data.docs.length === 0 ? (
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
                    k.answers.current > 0 ? `Cited by ${k.answers.current} Ask answer${k.answers.current === 1 ? "" : "s"}` : null,
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
                  {k.answers.stale > 0 && (
                    <span className="text-[var(--lk-stamp)]">
                      {" · "}
                      {k.answers.stale} Ask answer{k.answers.stale === 1 ? " cites" : "s cite"} a page it replaced
                    </span>
                  )}
                </span>
              </li>
            ))}
            {data.docs.map((d) => (
              <li key={d.id} className="border-t border-border py-1.5 first:border-t-0">
                <span className="lk-tag mr-2">Saved</span>
                <a href={d.url} target="_blank" rel="noreferrer" className="font-reading text-base underline-offset-2 hover:underline">
                  {page(d)}
                </a>
                {d.citedBy > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {" "}
                    · cited by {d.citedBy} Ask answer{d.citedBy === 1 ? "" : "s"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {data.reask.length > 0 && (
            <>
              <h3 className="lk-sec mt-3">Answers to ask again</h3>
              <ul className="mt-1 grid">
                {data.reask.slice(0, 5).map((a) => (
                  <li key={a.id} className="border-t border-border py-1.5 first:border-t-0">
                    <span className="font-reading text-base">“{a.question ?? a.chatTitle}”</span>
                    <span className="lk-stamp ml-2">Out of date</span>
                    <span className="block text-sm text-muted-foreground">
                      {a.cited
                        .map((c) => `${c.page != null ? pageLabel(c.page) : c.title} ${c.now ? `replaced by ${c.now.page != null ? pageLabel(c.now.page) : c.now.title}` : "deleted"}`)
                        .join(" · ")}
                      {a.question && a.chatTitle.startsWith(a.question.slice(0, 40)) ? "" : ` · in “${a.chatTitle}”`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.keystones.length > 0 && <h3 className="lk-sec mt-3">Decisions the most work rests on</h3>}
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
