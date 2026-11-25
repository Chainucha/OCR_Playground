import { Card } from "@/components/ui/card";
import { modelInfo } from "@/modules/engines";
import { toPlainText } from "@/modules/scoring";

import type { Slot } from "../core/run";
import { Extra, Missing } from "./marks";

export function TextColumn({ slot: run, highlight }: { slot: Slot; highlight: boolean }) {
  const info = modelInfo(run.engine);
  return (
    <Card className="gap-2 p-4">
      <h3 className="font-semibold">
        {info.name}
        {run.status === "done" && run.diff && (
          <span className="text-sm font-normal text-muted-foreground">
            {" "}
            · {run.diff.mistakes} mistake{run.diff.mistakes === 1 ? "" : "s"}
          </span>
        )}
      </h3>
      {run.status === "reading" && (
        <div aria-hidden className="flex flex-col gap-3 pt-1">
          {[80, 60, 90, 70, 55].map((w) => (
            <div key={w} className="h-3.5 animate-pulse rounded bg-muted motion-reduce:animate-none" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {run.status === "waiting" && <p className="text-sm text-muted-foreground">Waiting for its turn.</p>}
      {run.status === "failed" && <p className="text-sm text-muted-foreground">No text. See the card above.</p>}
      {run.status === "done" && (
        <p lang="th" className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {highlight && run.diff
            ? run.diff.segments.map((s, i) =>
                s.kind === "same" ? (
                  <span key={i}>{s.text}</span>
                ) : s.kind === "missing" ? (
                  <Missing key={i}>{s.text}</Missing>
                ) : (
                  <Extra key={i}>{s.text}</Extra>
                ),
              )
            : toPlainText(run.result.text)}
        </p>
      )}
    </Card>
  );
}
