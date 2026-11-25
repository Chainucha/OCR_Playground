import { Info, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { type Stage, explainError, modelInfo } from "@/modules/engines";

import { type Slot, accuracy, plural, seconds } from "../core/run";

/** Seconds since `since`, ticking. Its own component, so the tick re-renders this text and not the whole page. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{seconds(now - since)} sec</span>;
}

/** Each step of one read, in order and without overlap, so the rows add up to the total. Every column opens and closes
 * together, so the steps can be compared across models. */
function TimeBreakdown({
  stages,
  total,
  open,
  onOpen,
}: {
  stages: Stage[];
  total: number;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const share = (ms: number) => (total > 0 ? (100 * ms) / total : 0);
  return (
    <details className="text-sm" open={open} onToggle={(e) => onOpen(e.currentTarget.open)}>
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

/** A model's name and how it did, at the top of its column. Mistakes lead: "2 mistakes" says more to most people than
 * "99.0%". */
export function ModelHead({
  slot: run,
  best,
  together,
  hasReference,
  showTimes,
  onShowTimes,
}: {
  slot: Slot;
  best: boolean;
  together: boolean;
  hasReference: boolean;
  showTimes: boolean;
  onShowTimes: (open: boolean) => void;
}) {
  const info = modelInfo(run.engine);
  const title = (
    <div className="flex flex-wrap items-center gap-1.5">
      <h3 className="mr-auto font-semibold wrap-anywhere text-primary">{info.name}</h3>
      {best && <Badge className="bg-success-muted text-success-muted-foreground">Fewest mistakes</Badge>}
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
      <>
        {title}
        <p className="text-sm text-muted-foreground">{info.goodFor}</p>
        {run.status === "waiting" ? (
          <p className="font-medium text-muted-foreground">Waiting for its turn</p>
        ) : (
          <p className="font-medium">
            Reading… <Elapsed since={run.startedAt} />
          </p>
        )}
      </>
    );
  }

  if (run.status === "failed") {
    return (
      <>
        {title}
        <p role="alert" className="flex gap-2 rounded-md border border-dashed border-warning-border bg-warning p-2.5 text-sm text-warning-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {explainError(run.engine, run.error)}
        </p>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 font-mono text-xs break-all">{run.error}</p>
        </details>
      </>
    );
  }

  const { result, diff } = run;
  const took = `${seconds(run.ms)} sec`;
  let headline: string;
  let detail: string;
  if (result.cer !== null && diff) {
    headline = diff.mistakes === 0 ? "No mistakes" : plural(diff.mistakes, "mistake");
    detail = `${accuracy(result.cer)} accurate, took ${took}`;
  } else if (result.cer !== null) {
    headline = `${accuracy(result.cer)} accurate`;
    detail = `Took ${took}. The text is too long to mark each mistake.`;
  } else {
    headline = took;
    detail = hasReference ? "" : "Add the correct text to count mistakes.";
  }
  return (
    <>
      {title}
      <div>
        <p className="text-2xl leading-tight font-semibold tabular-nums">{headline}</p>
        {detail && <p className="text-sm text-muted-foreground tabular-nums">{detail}</p>}
      </div>
      {result.cold && <Note>The time may read high: the model was still warming up.</Note>}
      {together && <Note>The time may read high: other models were reading at the same time.</Note>}
      <TimeBreakdown stages={run.stages} total={run.ms} open={showTimes} onOpen={onShowTimes} />
    </>
  );
}
