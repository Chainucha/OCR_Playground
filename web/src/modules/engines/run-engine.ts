// Runs one engine on one page, timed from the moment the request is sent to the moment the result arrives, and warms
// engines up when the page opens so that the times shown are steady ones.

import { runOcr } from "./api-client";
import { type EngineResult, type Stage, WARMUP_RUNS } from "./core/types";
import { BROWSER_ENGINE, runInBrowser } from "./openthai/browser";

export type Timed = {
  result: EngineResult;
  /** Request sent to result received: upload, queueing, the engine's own time, and the reply. */
  roundTripMs: number;
  /**
   * The whole round trip in order, without overlap: what the engine reported, after "Send and receive" for what it
   * could not see (the upload, network and reply, or the hand-off to the browser worker and back).
   */
  stages: Stage[];
};

export async function runEngine(name: string, file: File, groundTruth: string): Promise<Timed> {
  const start = performance.now();
  const result = await (name === BROWSER_ENGINE.name
    ? runInBrowser(file, groundTruth)
    : runOcr(file, [name], groundTruth).then(([r]) => r)
  ).catch((err): EngineResult => ({ ok: false, engine: name, error: String(err) }));
  const roundTripMs = performance.now() - start;
  if (!result.ok) return { result, roundTripMs, stages: [] };
  // An engine API without stages still reports its own time, so the breakdown keeps that much.
  const reported = result.stages ?? [{ name: "Engine", ms: result.latency_ms }];
  const seen = reported.reduce((sum, s) => sum + s.ms, 0);
  return { result, roundTripMs, stages: [{ name: "Send and receive", ms: Math.max(0, roundTripMs - seen) }, ...reported] };
}

export type Readiness = { state: "warming" } | { state: "ready" } | { state: "failed"; error: string };

const warming = new Map<string, Promise<Readiness>>();
let practicePage: Promise<File> | null = null;

/**
 * Gets an engine past warm-up: downloads or loads its model, then reads the practice page (public/warmup.png, a
 * synthetic invoice) until it has done WARMUP_RUNS pages. `runsSoFar` is what the engine has already done, from
 * GET /engines. Starts once per engine per page load, so React running effects twice does not double it.
 */
export function warmUp(name: string, runsSoFar: number): Promise<Readiness> {
  let ready = warming.get(name);
  if (!ready) {
    ready = (async (): Promise<Readiness> => {
      if (runsSoFar >= WARMUP_RUNS) return { state: "ready" };
      practicePage ??= fetch("/warmup.png")
        .then((res) => {
          if (!res.ok) throw new Error(`practice page: HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => new File([blob], "warmup.png", { type: "image/png" }));
      const page = await practicePage;
      for (let run = runsSoFar; run < WARMUP_RUNS; run++) {
        const { result } = await runEngine(name, page, "");
        if (!result.ok) return { state: "failed", error: result.error };
      }
      return { state: "ready" };
    })().catch((err): Readiness => ({ state: "failed", error: String(err) }));
    warming.set(name, ready);
  }
  return ready;
}
