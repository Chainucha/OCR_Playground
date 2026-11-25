// OpenThai OCR-Text in the browser: iApp's det.onnx, rec.onnx and rec2.onnx with the core of runtime/line_engine.py
// ported. Ported: detection, line crops, splitting lines at wide gaps, tall boxes read both ways, the "flatten" colour
// step, batched CTC recognition, the rec2 re-read for loopless fonts, row order, text clean-up and the line filter.
// Not ported: page rotation and deskew, column detection, and floating mark re-attachment.

import { DET, boxesFromMap, roundHalfEven } from "./detect";
import { type Quad, type Raster, flatten, padWhite, resizeLinear, splitRgba, warpQuad } from "./image";
import { cleanLine, dropReason } from "./text";

export type ModelName = "det" | "rec" | "rec2";

/** Runs one network on a float32 NCHW tensor and returns its first output. */
export type RunModel = (
  model: ModelName,
  input: Float32Array,
  dims: number[],
) => Promise<{ data: Float32Array; dims: readonly number[] }>;

export type PageLine = { text: string; confidence: number; box: Quad };
/**
 * Milliseconds per step, split where LineOCR.read splits its det_ms and rec_ms: `prepare` is the colour conversion,
 * `detect` finding the lines, `read` splitting, recognising and ordering them, `assemble` filtering and joining them.
 */
export type PageTiming = { prepare: number; detect: number; read: number; assemble: number };
export type PageResult = {
  text: string;
  lines: PageLine[];
  dropped: (PageLine & { reason: string })[];
  timing: PageTiming;
};

const REC = { height: 48, maxW: 3200, batch: 16 };
const SPLIT_GAP = 1.2;
const DROP_BELOW = 0.8;
const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function detect(bgr: Raster, run: RunModel): Promise<Quad[]> {
  const pad = Math.max(8, Math.floor(0.05 * Math.min(bgr.width, bgr.height)));
  const padded = padWhite(bgr, pad);
  const s = Math.min(DET.limit / Math.max(padded.width, padded.height), 4);
  const rw = Math.max(32, roundHalfEven((padded.width * s) / 32) * 32);
  const rh = Math.max(32, roundHalfEven((padded.height * s) / 32) * 32);
  const img = resizeLinear(padded, rw, rh);
  const n = rw * rh;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) x[c * n + i] = (img.data[i * 3 + c] / 255 - DET_MEAN[c]) / DET_STD[c];
  }
  const out = await run("det", x, [1, 3, rh, rw]);
  const mh = out.dims[2], mw = out.dims[3];
  return boxesFromMap(out.data, mw, mh, {
    width: bgr.width, height: bgr.height, pad, sx: padded.width / mw, sy: padded.height / mh,
  });
}

function rot90(g: Raster, k: 1 | -1): Raster {
  // np.rot90: k=1 is a quarter turn counter-clockwise, k=-1 clockwise.
  const { width: w, height: h, data } = g;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) out[i * h + j] = k === 1 ? data[j * w + (w - 1 - i)] : data[(h - 1 - j) * w + i];
  }
  return { data: out, width: h, height: w, channels: 1 };
}

/** One line cut out of the page along its quad, as cut (crop_line with turn=0). */
function cut(gray: Raster, q: Quad): Raster {
  const w = Math.max(1, Math.trunc(Math.max(dist(q[0], q[1]), dist(q[2], q[3]))));
  const h = Math.max(1, Math.trunc(Math.max(dist(q[0], q[3]), dist(q[1], q[2]))));
  return warpQuad(gray, q, w, h);
}

type Reading = { text: string; conf: number; turned: boolean };

async function recognize(crops: Raster[], run: RunModel, model: "rec" | "rec2", chars: string[]): Promise<Reading[]> {
  const H = REC.height;
  // The "flatten" colour step runs at the recognizer's height, as recognize_detail does it.
  const lines = crops.map((c) => flatten(resizeLinear(c, Math.max(1, Math.ceil((H * c.width) / Math.max(c.height, 1))), H)));
  const out: Reading[] = lines.map(() => ({ text: "", conf: 0, turned: false }));
  const order = lines.map((_, i) => i).sort((a, b) => lines[a].width - lines[b].width);
  for (let b = 0; b < order.length; b += REC.batch) {
    const idx = order.slice(b, b + REC.batch);
    const W = Math.min(REC.maxW, Math.max(16, Math.max(...idx.map((i) => lines[i].width))));
    // 0 is mid-grey after normalising, the padding the recognizer was trained with.
    const x = new Float32Array(idx.length * 3 * H * W);
    idx.forEach((i, n) => {
      const c = lines[i];
      const rw = Math.min(W, c.width);
      for (let y = 0; y < H; y++) {
        for (let xx = 0; xx < rw; xx++) {
          const v = (c.data[y * c.width + xx] / 255 - 0.5) / 0.5;
          for (let ch = 0; ch < 3; ch++) x[((n * 3 + ch) * H + y) * W + xx] = v;
        }
      }
    });
    const res = await run(model, x, [idx.length, 3, H, W]);
    const [, T, C] = res.dims;
    idx.forEach((i, n) => {
      let text = "", sum = 0, kept = 0, prev = -1;
      for (let t = 0; t < T; t++) {
        let id = 0, best = -Infinity;
        for (let k = 0; k < C; k++) {
          const p = res.data[(n * T + t) * C + k];
          if (p > best) [best, id] = [p, k];
        }
        if (id !== prev && id !== 0) {
          text += chars[id] ?? "";
          sum += best;
          kept += 1;
        }
        prev = id;
      }
      out[i] = { text, conf: kept ? sum / kept : 0, turned: false };
    });
  }
  return out;
}

/** Latin letters inside words that also hold Thai letters: a loopless Thai face read as Latin look-alikes. */
function mixed(text: string): number {
  let n = 0;
  for (const tok of text.split(/\s+/)) {
    if (/[ก-๎]/.test(tok)) n += (tok.match(/[A-Za-z]/g) ?? []).length;
  }
  return n;
}

/**
 * Reads every box (LineOCR._read_boxes). A box taller than wide is read as cut and turned both ways, keeping the most
 * confident reading. A line with Latin letters inside Thai words is read again with rec2 when it is loaded.
 */
async function readBoxes(gray: Raster, boxes: Quad[], run: RunModel, chars: string[], rec2: boolean): Promise<Reading[]> {
  const raw = boxes.map((q) => cut(gray, q));
  const tall = raw.flatMap((c, n) => (c.height >= 1.5 * c.width ? [n] : []));
  const turned = ([1, -1] as const).flatMap((k) => tall.map((n) => rot90(raw[n], k)));
  const res = await recognize([...raw, ...turned], run, "rec", chars);
  const out = res.slice(0, raw.length);
  tall.forEach((n, j) => {
    for (const alt of [res[raw.length + j], res[raw.length + tall.length + j]]) {
      if (alt.conf > out[n].conf) out[n] = { ...alt, turned: true };
    }
  });
  const sus = rec2 ? out.flatMap((r, n) => (!r.turned && mixed(r.text) >= 1 ? [n] : [])) : [];
  if (sus.length) {
    const alts = await recognize(sus.map((n) => raw[n]), run, "rec2", chars);
    sus.forEach((n, j) => {
      if (mixed(alts[j].text) < mixed(out[n].text)) out[n] = alts[j];
    });
  }
  return out;
}

/**
 * One line box -> its pieces between blank stretches at least SPLIT_GAP times its height, with such a stretch trimmed
 * off either end (split_one). Null when the box stays whole.
 */
function splitOne(gray: Raster, b: Quad): Quad[] | null {
  const c = cut(gray, b);
  const { width: w, height: h } = c;
  if (w < 4 * h || h < 4) return null;
  const flat = flatten(c);
  const ink = Array.from({ length: w }, (_, x) => {
    for (let y = 0; y < h; y++) if (flat.data[y * w + x] < 128) return true;
    return false;
  });
  const segs: [number, number][] = [];
  let start = -1, blank = 0;
  ink.forEach((on, x) => {
    if (on) {
      if (start < 0) start = x;
      else if (blank >= SPLIT_GAP * h) {
        segs.push([start, x - blank]);
        start = x;
      }
      blank = 0;
    } else if (start >= 0) blank += 1;
  });
  if (start >= 0) segs.push([start, w - blank]);
  if (!segs.length || (segs.length === 1 && segs[0][0] < SPLIT_GAP * h && w - segs[0][1] < SPLIT_GAP * h)) return null;
  const top = [b[1][0] - b[0][0], b[1][1] - b[0][1]], bot = [b[2][0] - b[3][0], b[2][1] - b[3][1]];
  const along = (o: number[], d: number[], t: number): [number, number] => [o[0] + t * d[0], o[1] + t * d[1]];
  const pad = 0.15 * h;
  return segs.map(([x0, x1]) => {
    const t0 = Math.max(0, (x0 - pad) / w), t1 = Math.min(1, (x1 + pad) / w);
    return [along(b[0], top, t0), along(b[0], top, t1), along(b[3], bot, t1), along(b[3], bot, t0)];
  });
}

/**
 * Recognition with line splitting (LineOCR._page). A split line keeps its pieces only if every piece reads well enough
 * to survive the line filter and together they read at least 90 % of the characters the whole line does.
 */
async function readLines(gray: Raster, boxes: Quad[], run: RunModel, chars: string[], rec2: boolean) {
  const groups = boxes.map((b) => splitOne(gray, b));
  const pieces = groups.flatMap((g, i) => g ?? [boxes[i]]);
  const whole = boxes.filter((_, i) => groups[i]);
  const res = await readBoxes(gray, [...pieces, ...whole], run, chars, rec2);
  const final: Quad[] = [];
  const reads: Reading[] = [];
  let k = 0, e = pieces.length;
  boxes.forEach((b, i) => {
    const g = groups[i] ?? [b];
    const r = res.slice(k, k + g.length);
    k += g.length;
    if (groups[i]) {
      const alt = res[e++];
      const nPieces = r.reduce((s, x) => s + x.text.replaceAll(" ", "").length, 0);
      if (Math.min(...r.map((x) => x.conf)) < DROP_BELOW || nPieces < 0.9 * alt.text.replaceAll(" ", "").length) {
        final.push(b);
        reads.push(alt);
        return;
      }
    }
    final.push(...g);
    reads.push(...r);
  });
  return { boxes: final, reads };
}

/** Typical line height: the median over boxes at least twice as wide as tall (line_engine.line_height). */
function lineHeight(boxes: Quad[]): number {
  const hs = boxes.map((b) => Math.max(dist(b[0], b[3]), 1));
  const lines = hs.filter((h, i) => dist(boxes[i][0], boxes[i][1]) >= 2 * h);
  return hs.length ? median(lines.length >= 3 ? lines : hs) : 1;
}

function pageSkew(boxes: Quad[]): number {
  const angles = boxes
    .filter((b) => dist(b[0], b[1]) >= 3 * Math.max(dist(b[0], b[3]), 1))
    .map((b) => (Math.atan2(b[1][1] - b[0][1], b[1][0] - b[0][0]) * 180) / Math.PI);
  return angles.length ? median(angles) : 0;
}

/** Rows top to bottom, each left to right, in deskewed coordinates (reading_order without its column logic). */
function readingOrder(boxes: Quad[]): number[][] {
  const a = (-pageSkew(boxes) * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const ext = boxes.map((b) => {
    const xs = b.map(([x, y]) => x * cos - y * sin), ys = b.map(([x, y]) => x * sin + y * cos);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });
  const hmed = lineHeight(boxes);
  const hs = boxes.map((b) => Math.max(dist(b[0], b[3]), 1));
  const tol = 0.5 * hmed;
  const all = boxes.map((_, i) => i);
  let full = all.filter((i) => hs[i] >= 0.6 * hmed);
  if (!full.length) full = all;
  const small = all.filter((i) => !full.includes(i));
  const rows: number[][] = [];
  const mean = (r: number[]) => r.reduce((s, j) => s + ext[j].cy, 0) / r.length;
  for (const i of [...full].sort((p, q) => ext[p].cy - ext[q].cy)) {
    if (rows.length && Math.abs(ext[i].cy - mean(rows[rows.length - 1])) <= tol) rows[rows.length - 1].push(i);
    else rows.push([i]);
  }
  const centre = rows.map(mean);
  for (const i of small) {
    const d = centre.map((c) => Math.abs(ext[i].cy - c));
    const best = d.indexOf(Math.min(...d));
    if (d.length && d[best] <= tol + 0.5 * hs[i]) rows[best].push(i);
    else {
      rows.push([i]);
      centre.push(ext[i].cy);
    }
  }
  return rows
    .map((r, k) => ({ r, c: centre[k] }))
    .sort((p, q) => p.c - q.c)
    .map(({ r }) => [...r].sort((p, q) => ext[p].cx - ext[q].cx));
}

/**
 * Reads one page. `chars` is rec_dict.txt with the CTC blank in front and PaddleOCR's space at the end. `rec2` says
 * whether `run` can serve the second recognizer.
 */
export async function readPage(
  rgba: Uint8ClampedArray, width: number, height: number, run: RunModel, chars: string[], rec2: boolean,
): Promise<PageResult> {
  const t0 = performance.now();
  const { bgr, gray } = splitRgba(rgba, width, height);
  const t1 = performance.now();
  let found = await detect(bgr, run);
  if (!found.length && height <= 200 && width >= 1.5 * height) {
    // A single line or field crop: read the whole image as one line.
    found = [[[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]];
  }
  const t2 = performance.now();
  const { boxes, reads } = await readLines(gray, found, run, chars, rec2);
  const rowOrder = readingOrder(boxes);
  const t3 = performance.now();
  const hmed = boxes.length ? lineHeight(boxes) : 1;
  const lines: PageLine[] = [];
  const dropped: PageResult["dropped"] = [];
  const rows: string[] = [];
  for (const row of rowOrder) {
    const parts: string[] = [];
    for (const i of row) {
      const line = { text: cleanLine(reads[i].text), confidence: Math.round(reads[i].conf * 1e4) / 1e4, box: boxes[i] };
      const reason = dropReason(line.text, reads[i].conf, dist(boxes[i][0], boxes[i][3]) / hmed);
      if (reason) {
        dropped.push({ ...line, reason });
        continue;
      }
      parts.push(line.text);
      lines.push(line);
    }
    if (parts.length) rows.push(parts.join(" "));
  }
  const text = rows.join("\n");
  const timing = { prepare: t1 - t0, detect: t2 - t1, read: t3 - t2, assemble: performance.now() - t3 };
  return { text, lines, dropped, timing };
}
