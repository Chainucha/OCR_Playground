// Browser side of the parity check between OpenThai OCR-Text in Python and its browser port (openthai/ocr.ts).
//
// Reads the folder engines/scripts/openthai_parity.py wrote (<name>.bgr pixels and <name>.json from LineOCR.read),
// runs readPage in Node on the same pixels with onnxruntime-web (WebAssembly, the browser's numerics) and the ONNX
// files in models/openthai-text, and reports per page: text identical, CER between the two texts, the worst line box
// offset in pixels, and both times. The browser side's output goes to <folder>/ts/<name>.json.
//
// Usage, from web/:  npx tsx scripts/openthai-parity.ts <folder> [model folder] [page name ...]

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as ort from "onnxruntime-web/wasm";
import { type ModelName, readPage } from "../src/modules/engines/openthai/ocr";
import { cer } from "../src/modules/scoring";

type Box = number[][];
type RefLine = { text: string; box: Box };
type Ref = { width: number; height: number; ms: number; text: string; lines: RefLine[]; rotation: number };

const [folder, modelDir = resolve("../models/openthai-text"), ...only] = process.argv.slice(2);
if (!folder) throw new Error("usage: npx tsx scripts/openthai-parity.ts <folder> [model folder] [page name ...]");

/** Largest corner distance between two boxes. */
const boxGap = (a: Box, b: Box) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

/** Worst offset over every line of either side, each matched to the closest box on the other side. */
function worstBox(a: Box[], b: Box[]): number {
  if (!a.length || !b.length) return a.length || b.length ? Infinity : 0;
  const one = (from: Box[], to: Box[]) => Math.max(...from.map((x) => Math.min(...to.map((y) => boxGap(x, y)))));
  return Math.max(one(a, b), one(b, a));
}

async function main() {
  ort.env.wasm.numThreads = 1;
  const session = (file: string) => ort.InferenceSession.create(readFileSync(join(modelDir, file)), { executionProviders: ["wasm"] });
  const sessions: Record<ModelName, ort.InferenceSession> = {
    det: await session("det.onnx"), rec: await session("rec.onnx"), rec2: await session("rec2.onnx"),
  };
  const dict = readFileSync(join(modelDir, "rec_dict.txt"), "utf8");
  const chars = ["", ...dict.split("\n").filter(Boolean), " "];
  const run = async (model: ModelName, input: Float32Array, dims: number[]) => {
    const s = sessions[model];
    const out = (await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, dims) }))[s.outputNames[0]];
    return { data: out.data as Float32Array, dims: out.dims };
  };

  const names = readdirSync(folder).filter((f) => f.endsWith(".bgr")).map((f) => f.slice(0, -4))
    .filter((n) => !only.length || only.includes(n)).sort();
  mkdirSync(join(folder, "ts"), { recursive: true });
  const rows: string[][] = [];
  let identical = 0;
  for (const name of names) {
    const ref: Ref = JSON.parse(readFileSync(join(folder, `${name}.json`), "utf8"));
    const bgr = readFileSync(join(folder, `${name}.bgr`));
    const rgba = new Uint8ClampedArray(ref.width * ref.height * 4);
    for (let i = 0; i < ref.width * ref.height; i++) {
      rgba.set([bgr[i * 3 + 2], bgr[i * 3 + 1], bgr[i * 3], 255], i * 4);
    }
    const start = performance.now();
    const page = await readPage(rgba, ref.width, ref.height, run, chars, true);
    const ms = performance.now() - start;
    writeFileSync(join(folder, "ts", `${name}.json`), JSON.stringify({ ...page, ms }, null, 1));
    const same = page.text === ref.text;
    identical += Number(same);
    const rotation = (page as { rotation?: number }).rotation ?? 0;
    rows.push([
      name, same ? "yes" : "no", `${(cer(ref.text, page.text) * 100).toFixed(2)}%`,
      worstBox(ref.lines.map((l) => l.box), page.lines.map((l) => l.box)).toFixed(1),
      `${ref.lines.length}/${page.lines.length}`, `${ref.rotation}/${rotation}`,
      (ref.ms / 1000).toFixed(1), (ms / 1000).toFixed(1),
    ]);
    console.log(rows[rows.length - 1].join("\t"));
  }
  const head = ["page", "same text", "CER", "worst box px", "lines py/ts", "rotation py/ts", "py s", "ts s"];
  const table = [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
  writeFileSync(join(folder, "report.md"), `${table}\n\nIdentical text: ${identical} of ${names.length}\n`);
  console.log(`\n${table}\n\nIdentical text: ${identical} of ${names.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
