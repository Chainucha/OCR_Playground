import { Fragment } from "react";

import { toLines } from "@/modules/scoring";

import type { Slot } from "../core/run";
import { Extra, Missing } from "./marks";

/** The text a model read, under its head in the same column. Headings it wrote show as headings. */
export function ModelText({ slot: run, highlight }: { slot: Slot; highlight: boolean }) {
  return (
    <>
      {(run.status === "reading" || run.status === "waiting") && (
        <div aria-hidden className={`flex flex-col gap-3 pt-1 ${run.status === "waiting" ? "opacity-40" : ""}`}>
          {[80, 60, 90, 70, 55].map((w) => (
            <div
              key={w}
              className={`h-3.5 rounded bg-muted ${run.status === "reading" ? "animate-pulse motion-reduce:animate-none" : ""}`}
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      )}
      {run.status === "failed" && <p className="text-sm text-muted-foreground">No text from this model.</p>}
      {run.status === "done" && (
        <p lang="th" className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {toLines(run.result.text, highlight ? run.diff?.segments : undefined).map((line, i) => (
            <Fragment key={i}>
              {i > 0 && "\n"}
              <span className={line.heading ? "text-base font-semibold text-primary" : undefined}>
                {line.segments.map((s, k) =>
                  s.kind === "same" ? (
                    <span key={k}>{s.text}</span>
                  ) : s.kind === "missing" ? (
                    <Missing key={k}>{s.text}</Missing>
                  ) : (
                    <Extra key={k}>{s.text}</Extra>
                  ),
                )}
              </span>
            </Fragment>
          ))}
        </p>
      )}
    </>
  );
}
