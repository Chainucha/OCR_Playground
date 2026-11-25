// Web Worker that owns the ONNX sessions and runs readPage, so OCR never blocks the page's main thread.

import { cer } from "@/modules/scoring";
import { type Line, type Stage, WARMUP_RUNS } from "../core/types";
import { type ModelName, readPage } from "./ocr";

// Pinned to the Hugging Face commit the Python engine was checked against, so iApp's updates can't change results
// under us. Override with a folder that serves the same files (det.onnx, rec.onnx, rec2.onnx, rec_dict.txt).
const MODEL_URL =
  process.env.NEXT_PUBLIC_OPENTHAI_TEXT_URL ??
  "https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118/resolve/c765cb8017c406ddc2a518de51db22bb2e2bbd07";

export type OcrRequest = { id: number; file: File; groundTruth: string };
export type OcrResponse = { id: number } & (
  | { ok: true; text: string; latency_ms: number; lines: Line[]; cer: number | null; cold: boolean; stages: Stage[] }
  | { ok: false; error: string }
);

type Ort = typeof import("onnxruntime-web/wasm");
type Loaded = { ort: Ort; sessions: Record<ModelName, import("onnxruntime-web/wasm").InferenceSession>; chars: string[] };

let loading: Promise<Loaded> | null = null;
// Pages this worker has finished. The first WARMUP_RUNS read slow while the ONNX sessions and the browser's
// WebAssembly and JavaScript compilers warm up.
let runs = 0;

async function fetchOk(path: string): Promise<Response> {
  const res = await fetch(`${MODEL_URL}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} from ${MODEL_URL}`);
  return res;
}

async function load(): Promise<Loaded> {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
  const session = async (file: string) =>
    ort.InferenceSession.create(new Uint8Array(await (await fetchOk(file)).arrayBuffer()), { executionProviders: ["wasm"] });
  const [det, rec, rec2, dict] = await Promise.all([
    session("det.onnx"), session("rec.onnx"), session("rec2.onnx"), fetchOk("rec_dict.txt").then((r) => r.text()),
  ]);
  // CTC classes: 0 is the blank, then the dictionary, then the space PaddleOCR appends.
  return { ort, sessions: { det, rec, rec2 }, chars: ["", ...dict.split("\n").filter(Boolean), " "] };
}

async function decode(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** OCRs one image. The first call downloads the models; latency counts only the OCR. */
async function ocr({ file, groundTruth }: OcrRequest): Promise<Omit<Extract<OcrResponse, { ok: true }>, "id">> {
  const waiting = performance.now();
  loading ??= load();
  const { ort, sessions, chars } = await loading.catch((err) => {
    loading = null;
    throw err;
  });
  const cold = runs < WARMUP_RUNS;
  // The engine's own time runs from opening the image to the assembled text, as it does for the Python engine.
  const start = performance.now();
  const img = await decode(file);
  const decoded = performance.now();
  const page = await readPage(img.data, img.width, img.height, async (model, input, dims) => {
    const s = sessions[model];
    const out = (await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, dims) }))[s.outputNames[0]];
    return { data: out.data as Float32Array, dims: out.dims };
  }, chars, true);
  const latency_ms = performance.now() - start;
  runs += 1;
  const { prepare, detect, read, assemble } = page.timing;
  const stages: Stage[] = [
    { name: "Wait to start", ms: start - waiting },
    { name: "Open image", ms: decoded - start + prepare },
    { name: "Find text lines", ms: detect },
    { name: "Read text", ms: read },
    { name: "Assemble text", ms: assemble },
  ];
  const scoring = performance.now();
  const score = groundTruth.trim() ? cer(groundTruth, page.text) : null;
  if (score !== null) stages.push({ name: "Score accuracy", ms: performance.now() - scoring });
  return {
    ok: true,
    cold,
    text: page.text,
    latency_ms,
    lines: page.lines.map((l) => ({ text: l.text, confidence: l.confidence, box: l.box })),
    cer: score,
    stages,
  };
}

self.onmessage = async ({ data }: MessageEvent<OcrRequest>) => {
  const reply: OcrResponse = await ocr(data).then(
    (r) => ({ id: data.id, ...r }),
    (err) => ({ id: data.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  self.postMessage(reply);
};
