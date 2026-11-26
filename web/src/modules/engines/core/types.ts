// What the engine API and the browser engine send back. Plain TypeScript, shared by every part of this module.

/** Runs per engine that count as warm-up and read slow; matches WARMUP_RUNS in engines/src/ocr_playground/api/server.py. */
export const WARMUP_RUNS = 2;

export type EngineStatus = {
  name: string;
  description: string;
  available: boolean;
  reason: string | null;
  /** Pages the engine has finished since it started, so the page knows how much warm-up is left. */
  runs: number;
};

export type Line = {
  text: string;
  confidence: number | null;
  box: number[][] | null;
  /** The line's row in reading order, where the engine reports it. */
  row?: number;
  /** The line's words with their boxes, where the engine reports them. */
  words?: { text: string; confidence: number; box: number[][] }[];
};

/** One step of a run and how long it took. A result's stages don't overlap, so they add up to its time. */
export type Stage = { name: string; ms: number };

export type EngineResult =
  | {
      ok: true;
      engine: string;
      text: string;
      format: "text" | "markdown";
      latency_ms: number;
      lines: Line[];
      cer: number | null;
      /**
       * Where the time went, in order: the server's or the browser worker's share of the run. Missing from engine
       * APIs older than this page, which is deployed separately.
       */
      stages?: Stage[];
      /** One of the engine's first WARMUP_RUNS runs since it started: includes warm-up, so slower than usual. */
      cold: boolean;
    }
  | { ok: false; engine: string; error: string };
