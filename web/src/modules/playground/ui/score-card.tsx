import { Info, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { type Stage, explainError, modelInfo } from "@/modules/engines";

import { type Slot, accuracy, seconds } from "../core/run";

/** Seconds since `since`, ticking. Its own component, so the tick re-renders this text and not the whole page. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{seconds(now - since)} sec</span>;
}

/** Collapsed by default: each step of one read, in order and without overlap, so the rows add up to the total. */
function TimeBreakdown({ stages, total }: { stages: Stage[]; total: number }) {
  const share = (ms: number) => (total > 0 ? (100 * ms) / total : 0);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Where the time went</summary>
      <table className="mt-2 w-full tabular-nums">
        <tbody>
          {stages.map((s) => (
            <tr key={s.name}>
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {s.name}
                <span aria-hidden className="mt-1 block h-1 rounded bg-muted">
                  <span className="block h-full rounded bg-primary" style={{ width: `${share(s.ms)}%` }} />
                </span>
              </th>
              <td className="py-1 text-right whitespace-nowrap">{seconds(s.ms, 2)} sec</td>
              <td className="py-1 pl-2 text-right text-muted-foreground">{Math.round(share(s.ms))}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t">
          <tr>
            <th scope="row" className="pt-1 text-left font-medium">
              Total
            </th>
            <td className="pt-1 text-right font-medium whitespace-nowrap">{seconds(total, 2)} sec</td>
            <td className="pt-1 pl-2 text-right text-muted-foreground">100%</td>
          </tr>
        </tfoot>
      </table>
    </details>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1.5 text-sm text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

export function ScoreCard({
  slot: run,
  best,
  together,
  hasReference,
}: {
  slot: Slot;
  best: boolean;
  together: boolean;
  hasReference: boolean;
}) {
  const info = modelInfo(run.engine);
  const header = (
    <div className="flex flex-wrap items-center gap-1.5">
      <h3 className="mr-auto font-semibold">{info.name}</h3>
      {best && (
        <Badge className="bg-success-muted text-success-muted-foreground">Fewest mistakes</Badge>
      )}
      {info.badge && (
        <Badge variant="outline" className="gap-1">
          {info.private && <Lock aria-hidden className="size-3" />}
          {info.badge}
        </Badge>
      )}
    </div>
  );

  if (run.status === "waiting" || run.status === "reading") {
    return (
      <Card aria-busy className="gap-2 p-4">
        {header}
        <p className="text-sm text-muted-foreground">{info.goodFor}</p>
        {run.status === "waiting" ? (
          <p className="font-medium text-muted-foreground">Waiting for its turn</p>
        ) : (
          <>
            <p className="font-medium">
              Reading… <Elapsed since={run.startedAt} />
            </p>
            <div aria-hidden className="h-2 overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded bg-primary motion-reduce:animate-none" />
            </div>
          </>
        )}
      </Card>
    );
  }

  if (run.status === "failed") {
    return (
      <Card className="gap-2 border-2 border-dashed border-warning-border p-4">
        {header}
        <p role="alert" className="flex gap-2 rounded-md bg-warning p-2.5 text-sm text-warning-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {explainError(run.engine, run.error)}
        </p>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 font-mono text-xs break-all">{run.error}</p>
        </details>
      </Card>
    );
  }

  const { result, diff } = run;
  const took = seconds(run.ms);
  const notes = (
    <>
      {result.cold && <Note>The time may read high: the model was still warming up.</Note>}
      {together && <Note>The time may read high: other models were reading at the same time.</Note>}
      <TimeBreakdown stages={run.stages} total={run.ms} />
    </>
  );
  return (
    <Card className={`gap-2 p-4 ${best ? "border-2 border-success" : ""}`}>
      {header}
      <p className="text-sm text-muted-foreground">{info.goodFor}</p>
      {result.cer !== null ? (
        <>
          <p className="text-3xl leading-tight font-bold">
            {accuracy(result.cer)}
            <span className="text-sm font-medium text-muted-foreground"> accurate</span>
          </p>
          <div aria-hidden className="h-2 overflow-hidden rounded bg-muted">
            <div
              className={`h-full rounded ${best ? "bg-success" : "bg-primary"}`}
              style={{ width: `${Math.max(0, 1 - result.cer) * 100}%` }}
            />
          </div>
          <p className="text-sm">
            {diff
              ? diff.mistakes === 0
                ? "No mistakes"
                : `${diff.mistakes} mistake${diff.mistakes === 1 ? "" : "s"}`
              : "Too long to list mistakes"}{" "}
            · took {took} sec
          </p>
        </>
      ) : (
        <p className="text-sm">
          Took {took} sec.{" "}
          {!hasReference && <span className="text-muted-foreground">Add the correct text to see accuracy.</span>}
        </p>
      )}
      {notes}
    </Card>
  );
}
