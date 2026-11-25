import type { EngineResult, EngineStatus } from "./core/types";

const OCR_API_URL = process.env.NEXT_PUBLIC_OCR_API_URL ?? "http://localhost:8000";

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
