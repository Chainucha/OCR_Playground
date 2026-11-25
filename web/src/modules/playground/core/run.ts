// The state of a read and the words the page shows for it. Plain TypeScript, so it can be tested without a browser.

import type { EngineResult, Stage } from "@/modules/engines";
import type { Diff } from "@/modules/scoring";

type Done = Extract<EngineResult, { ok: true }>;

/** One at a time gives each model's own time; all at once is faster, but models sharing a computer slow each other. */
export type Mode = "queue" | "parallel";

/** One model's part in reading one page. Times are performance.now() values and milliseconds. */
export type Slot =
  | { engine: string; status: "waiting" }
  | { engine: string; status: "reading"; startedAt: number }
  | { engine: string; status: "done"; result: Done; ms: number; stages: Stage[]; diff: Diff | null }
  | { engine: string; status: "failed"; error: string };

export type DoneSlot = Extract<Slot, { status: "done" }>;

/** How one page was read. `reference` is the correct text as it was when the read began; `totalMs` is set once every
 * model has answered. */
export type Batch = { mode: Mode; reference: string; slots: Slot[]; totalMs: number | null };

/** `started` holds every page this press of Read has begun. `reading` is the one in flight, or null while the next
 * page is still being prepared. */
export type Run = { kind: "idle" } | { kind: "running"; started: ReadonlySet<string>; reading: string | null };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// A ticking clock can lag a start by one tick, so clamp rather than show -0.0.
export const seconds = (ms: number, digits = 1) => (Math.max(0, ms) / 1000).toFixed(digits);

export function accuracy(cer: number): string {
  if (cer <= 0) return "100%";
  // round down, so a page with mistakes never shows 100%
  return `${Math.max(0, Math.floor((1 - cer) * 1000) / 10).toFixed(1)}%`;
}

export const finished = (slots: Slot[]) => slots.filter((s): s is DoneSlot => s.status === "done");

/** "Fewest mistakes" only when one model is strictly ahead; a tie has no winner. */
export function bestEngine(slots: Slot[]): string | null {
  const scores = finished(slots).flatMap((r) => (r.result.cer === null ? [] : [{ engine: r.engine, cer: r.result.cer }]));
  const lowest = Math.min(...scores.map((s) => s.cer));
  const leaders = scores.filter((s) => s.cer === lowest);
  return scores.length > 1 && leaders.length === 1 ? leaders[0].engine : null;
}

/** The Read button's words. `readable` is every page that has not failed to open, in list order. */
export function readLabel(run: Run, readable: readonly { id: string }[], models: number, preparing: boolean): string {
  if (run.kind === "idle") {
    if (preparing) return "Getting models ready…";
    const what = readable.length > 1 ? ` ${plural(readable.length, "page")}` : "";
    return `Read${what} with ${plural(models, "model")}`;
  }
  if (readable.length <= 1) return run.reading ? "Reading…" : "Preparing the page…";
  // Finished pages still in the list, plus the one in progress, so removing a page mid-read shrinks both numbers.
  const n = readable.filter((p) => run.started.has(p.id) && p.id !== run.reading).length + 1;
  return `${run.reading ? "Reading" : "Preparing"} page ${n} of ${Math.max(n, readable.length)}…`;
}

/** One line on how the read of a page is going, for the status region above the score cards. */
export function progressLine(batch: Batch): string {
  const count = (status: Slot["status"]) => batch.slots.filter((s) => s.status === status).length;
  return [
    count("done") && `${count("done")} finished`,
    count("reading") && `${count("reading")} reading`,
    count("waiting") && `${count("waiting")} waiting ${count("waiting") === 1 ? "its" : "their"} turn`,
    count("failed") && `${count("failed")} need${count("failed") === 1 ? "s" : ""} another try`,
    batch.totalMs !== null && totalLine(batch),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The finished summary: how long the whole read took, and for all at once, what the separate times add up to. */
function totalLine(batch: Batch): string {
  const total = `${seconds(batch.totalMs ?? 0)} sec in total`;
  if (batch.mode === "queue" || batch.slots.length < 2) return `one at a time, ${total}`;
  const added = finished(batch.slots).reduce((sum, d) => sum + d.ms, 0);
  return `all at once, ${total} (the separate times add up to ${seconds(added)} sec)`;
}
