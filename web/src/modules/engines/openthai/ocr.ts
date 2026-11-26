// OpenThai OCR-Text in the browser: a full port of LineOCR.read from iApp's runtime/line_engine.py, the copy that
// ships with OpenThai2.1-OCR-Text-20261118 at commit c765cb8 (the one worker.ts pins). Same steps, thresholds and
// order: detection, page orientation and deskew, line splitting, recognition with rec2, column-aware reading order,
// floating marks, the line filter, word boxes, and boxes mapped back to the image as given. The image steps match
// OpenCV 5.1 bit for bit (image.ts, contours.ts), so a page reads the same as on the engine API up to float rounding
// in the networks. Not ported: LineEngine's process pool, HybridEngine's VLM fallback, the OpenVINO backend.
// No browser APIs here: web/scripts/openthai-parity.ts runs this in Node against the Python engine.

import { readingOrder } from "./columns";
import { CFG } from "./config";
import { detect } from "./detect";
import { boxHeight, lineHeight, pageSkew } from "./geometry";
import { type Mat3, type Point, type Quad, type Raster, applyMat, invert3, multiply3, rgbaToBgr, rot90 } from "./image";
import { type Page, attachMarks, fragments } from "./marks";
import { deskew, rot90Matrix, sideways, upsideDown } from "./orient";
import { readBoxes, splitOne } from "./recognize";
import { dropReason, joinRows, lineText } from "./text";
import type { Models, ModelName, Reading, RunModel } from "./types";
import { type Word, words } from "./words";

export type { ModelName, RunModel };

/** A line as LineOCR.read reports it: `row` is its row in reading order, boxes are in the image's own coordinates. */
export type PageLine = { text: string; confidence: number; row: number; box: Point[]; words: Word[] };
export type DroppedLine = Omit<PageLine, "words"> & { reason: string };
/**
 * Milliseconds per step, split where LineOCR.read splits det_ms and rec_ms: `prepare` is the colour conversion,
 * `detect` finding the lines with the orientation and deskew checks, `read` splitting, recognising and ordering them
 * (and the upside-down check and floating marks), `assemble` filtering and joining them.
 */
export type PageTiming = { prepare: number; detect: number; read: number; assemble: number };
export type PageResult = {
  text: string;
  lines: PageLine[];
  dropped: DroppedLine[];
  /** Degrees the lines lean on the page as given (the residual angle plus any deskew). */
  textAngle: number;
  /** Clockwise quarter turns, in degrees, that made the page upright: 0, 90, 180 or 270. */
  rotation: 0 | 90 | 180 | 270;
  timing: PageTiming;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
const round = (pts: Point[]): Point[] => pts.map(([x, y]) => [round1(x), round1(y)]);

/**
 * Recognition, then reading order: the column test looks at the text (_page). A line cut at a wide blank stretch
 * keeps its pieces only if every piece survives the confidence floor and together they read at least 90 % of the
 * characters the whole line does.
 */
async function readLines(img: Raster, boxes: Quad[], models: Models): Promise<Page> {
  const groups = boxes.map((b) => splitOne(img, b, CFG.det.splitGap));
  const pieces = groups.flatMap((g, i) => g ?? [boxes[i]]);
  const whole = boxes.filter((_, i) => groups[i]);
  const res = await readBoxes(img, [...pieces, ...whole], models);
  const final: Quad[] = [], reads: Reading[] = [];
  let k = 0, e = pieces.length;
  const bare = (r: Reading) => r.text.replaceAll(" ", "").length;
  boxes.forEach((b, i) => {
    const g = groups[i] ?? [b];
    const r = res.slice(k, k + g.length);
    k += g.length;
    if (groups[i]) {
      const alt = res[e++];
      if (Math.min(...r.map((x) => x.conf)) < CFG.rec.dropBelow || r.reduce((s, x) => s + bare(x), 0) < 0.9 * bare(alt)) {
        final.push(b);
        reads.push(alt);
        return;
      }
    }
    final.push(...g);
    reads.push(...r);
  });
  const angle = pageSkew(final);
  const rows = readingOrder(final, angle, reads.map((r) => r.text), CFG.cols);
  return { boxes: final, reads, rows, angle };
}

/**
 * Reads one page (LineOCR.read). `models.chars` is rec_dict.txt with the CTC blank in front and PaddleOCR's space at
 * the end; `models.rec2` says whether `run` can serve the second recognizer.
 */
export async function readPage(
  rgba: Uint8ClampedArray, width: number, height: number, run: RunModel, chars: string[], rec2: boolean,
): Promise<PageResult> {
  const models: Models = { run, chars, rec2 };
  const t0 = performance.now();
  let img = rgbaToBgr(rgba, width, height);
  const t1 = performance.now();
  let boxes = await detect(img, run);
  if (!boxes.length && height <= 200 && width >= 1.5 * height) {
    // A single line or field crop: read the whole image as one line.
    boxes = [[[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]];
  }
  const oc = CFG.ori;
  let rotation: PageResult["rotation"] = 0, skew = 0;
  let tf: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]; // original image -> working image
  if (oc.enabled) {
    const k = await sideways(img, boxes, models);
    if (k) {
      tf = multiply3(rot90Matrix(k, img.width, img.height), tf);
      img = rot90(img, k);
      boxes = await detect(img, run);
      rotation = k === -1 ? 90 : 270;
    }
    skew = pageSkew(boxes);
    if (Math.abs(skew) >= oc.deskewAbove) {
      const d = deskew(img, skew);
      img = d.img;
      tf = multiply3(d.m, tf);
      boxes = await detect(img, run);
    }
  }
  const t2 = performance.now();
  let page = await readLines(img, boxes, models);
  if (oc.enabled && !rotation && await upsideDown(img, page.boxes, page.reads, models)) {
    tf = multiply3(rot90Matrix(2, img.width, img.height), tf);
    img = rot90(img, 2);
    rotation = 180;
    page = await readLines(img, await detect(img, run), models);
  }
  const frag = fragments(page.boxes, page.reads);
  if (CFG.marks.enabled) for (const j of await attachMarks(img, page, frag, models)) frag.add(j);
  const t3 = performance.now();

  const back = invert3(tf);
  const lines: PageLine[] = [], dropped: DroppedLine[] = [];
  const rowTexts: string[] = [], rowGeom: ([number, number] | null)[] = [];
  const hmed = page.boxes.length ? lineHeight(page.boxes) : 1;
  page.rows.forEach((r, row) => {
    const parts: string[] = [];
    for (const i of r) {
      if (frag.has(i)) continue;
      const { conf, chars: positions } = page.reads[i];
      const text = lineText(page.reads[i].text);
      const box = page.boxes[i];
      const reason = dropReason(text, conf, boxHeight(box) / hmed);
      const entry = { text, confidence: Math.round(conf * 1e4) / 1e4, row, box: round(applyMat(back, box)) };
      if (reason) {
        dropped.push({ ...entry, reason });
        continue;
      }
      parts.push(text);
      const ws = words(positions, box, text, conf).map((w) => ({ ...w, box: round(applyMat(back, w.box)) }));
      lines.push({ ...entry, words: ws });
    }
    if (parts.length) {
      rowTexts.push(parts.join(" "));
      const ys = r.filter((j) => !frag.has(j)).flatMap((j) => page.boxes[j].map((p) => p[1]));
      rowGeom.push(ys.length ? [Math.min(...ys), Math.max(...ys)] : null);
    }
  });
  const straightened = Math.abs(skew) >= oc.deskewAbove ? skew : 0;
  const text = joinRows(rowTexts, rowGeom, hmed);
  const timing = { prepare: t1 - t0, detect: t2 - t1, read: t3 - t2, assemble: performance.now() - t3 };
  return { text, lines, dropped, textAngle: Math.round((page.angle + straightened) * 100) / 100, rotation, timing };
}
