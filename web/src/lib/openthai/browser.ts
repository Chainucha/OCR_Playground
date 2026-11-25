// Runs OpenThai OCR-Text in the browser with onnxruntime-web: nothing to install, and the image never leaves the device.
// The models and the OCR live in a Web Worker (worker.ts), so the page stays responsive while a page is read.

import type { EngineResult, EngineStatus } from "@/lib/ocr-api";
import type { OcrRequest, OcrResponse } from "./worker";

export const BROWSER_ENGINE: EngineStatus = {
  name: "openthai-text-browser",
  description: "OpenThai OCR-Text running in this browser (ONNX, about 7 MB on first use)",
  available: true,
  reason: null,
  runs: 0,
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: OcrResponse) => void>();

function start(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = ({ data }: MessageEvent<OcrResponse>) => {
    pending.get(data.id)?.(data);
    pending.delete(data.id);
  };
  // The worker script itself failed (load or uncaught error): fail every waiting run and start fresh next time.
  w.onerror = (e) => {
    e.preventDefault();
    for (const [id, settle] of pending) settle({ id, ok: false, error: `worker failed: ${e.message || "could not load"}` });
    pending.clear();
    w.terminate();
    worker = null;
  };
  return w;
}

/** OCRs one image in a Web Worker. The first call downloads the models; latency counts only the OCR. */
export async function runInBrowser(file: File, groundTruth: string): Promise<EngineResult> {
  const engine = BROWSER_ENGINE.name;
  worker ??= start();
  const request: OcrRequest = { id: nextId++, file, groundTruth };
  const r = await new Promise<OcrResponse>((settle) => {
    pending.set(request.id, settle);
    worker!.postMessage(request);
  });
  if (!r.ok) return { ok: false, engine, error: `${engine}: ${r.error}` };
  return {
    ok: true, engine, format: "text", text: r.text, latency_ms: r.latency_ms, lines: r.lines, cer: r.cer, cold: r.cold,
    stages: r.stages,
  };
}
