export const OCR_API_URL = process.env.NEXT_PUBLIC_OCR_API_URL ?? "http://localhost:8000";

/** Runs per engine that count as warm-up and read slow; matches WARMUP_RUNS in engines/src/ocr_playground/server.py. */
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
};

export type EngineResult =
  | {
      ok: true;
      engine: string;
      text: string;
      format: "text" | "markdown";
      latency_ms: number;
      lines: Line[];
      cer: number | null;
      /** One of the engine's first WARMUP_RUNS runs since it started: includes warm-up, so slower than usual. */
      cold: boolean;
    }
  | { ok: false; engine: string; error: string };

export async function listEngines(): Promise<EngineStatus[]> {
  const res = await fetch(`${OCR_API_URL}/engines`);
  if (!res.ok) throw new Error(`GET /engines failed: ${res.status}`);
  return res.json();
}

export async function runOcr(file: File, engines: string[], groundTruth: string): Promise<EngineResult[]> {
  const form = new FormData();
  form.append("file", file);
  for (const engine of engines) form.append("engines", engine);
  if (groundTruth.trim()) form.append("ground_truth", groundTruth);
  const res = await fetch(`${OCR_API_URL}/ocr`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`POST /ocr failed: ${res.status} ${await res.text()}`);
  return res.json();
}
