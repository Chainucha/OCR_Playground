// Line recognition: LineOCR.recognize_detail, _read_boxes and split_one. Lines are cut from the BGR page, scaled to
// the recognizer's height, flattened to dark-on-white grey, batched by width and decoded with greedy CTC.

import { CFG } from "./config";
import { norm } from "./geometry";
import { type Quad, type Raster, flatten, resizeLinear, rot90, toGray, warpQuad } from "./image";
import { mixed } from "./text";
import type { Char, ModelName, Models, Reading } from "./types";

const f32 = Math.fround;
// (pixel / 255 - 0.5) / 0.5 in float32: 0 is the mid-grey the recognizer pads with.
const NORM = Float32Array.from({ length: 256 }, (_, v) => f32((f32(v / 255) - 0.5) / 0.5));

// Crops already cut from a page, by box object: split_one and _read_boxes cut the same unchanged box twice.
const crops = new WeakMap<Raster, WeakMap<Quad, Raster>>();

/** One line cut out of the page along its quad, as cut (crop_line with turn=0). */
export function cropLine(img: Raster, q: Quad): Raster {
  let cache = crops.get(img);
  if (!cache) crops.set(img, (cache = new WeakMap()));
  let out = cache.get(q);
  if (!out) {
    const w = Math.max(1, Math.trunc(Math.max(norm(q[0], q[1]), norm(q[2], q[3]))));
    const h = Math.max(1, Math.trunc(Math.max(norm(q[0], q[3]), norm(q[1], q[2]))));
    out = warpQuad(img, q, w, h);
    cache.set(q, out);
  }
  return out;
}

/** Greedy CTC over one line's frames, with each character's span and probability (_ctc_detail). */
function ctc(probs: Float32Array, offset: number, T: number, C: number, stride: number, width: number, chars: string[]): Reading {
  const ids = new Int32Array(T), conf = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    let id = 0, best = -Infinity;
    const row = offset + t * C;
    for (let k = 0; k < C; k++) {
      if (probs[row + k] > best) {
        best = probs[row + k];
        id = k;
      }
    }
    ids[t] = id;
    conf[t] = best;
  }
  const out: Char[] = [];
  let sum = 0;
  for (let t = 0; t < T;) {
    let end = t + 1;
    while (end < T && ids[end] === ids[t]) end += 1;
    if (ids[t] !== 0) {
      out.push({ ch: chars[ids[t]] ?? "", x0: Math.min(1, (t * stride) / width), x1: Math.min(1, (end * stride) / width), p: conf[t] });
      sum += conf[t];
    }
    t = end;
  }
  return { text: out.map((c) => c.ch).join(""), conf: out.length ? sum / out.length : 0, chars: out };
}

/**
 * recognize_detail with color "flatten": each BGR crop scaled to the recognizer's height, made grey and flattened,
 * then read in batches of similar width, each batch padded to its widest line.
 */
export async function recognize(lines: Raster[], models: Models, model: ModelName = "rec"): Promise<Reading[]> {
  const { height: H, maxW, batch } = CFG.rec;
  const prepped = lines.map((c) => flatten(toGray(resizeLinear(c, Math.max(1, Math.ceil((H * c.width) / Math.max(c.height, 1))), H))));
  const ratios = prepped.map((c) => c.width / Math.max(c.height, 1));
  const out: Reading[] = lines.map(() => ({ text: "", conf: 0, chars: [] }));
  const order = prepped.map((_, i) => i).sort((a, b) => ratios[a] - ratios[b]);
  for (let b = 0; b < order.length; b += batch) {
    const idx = order.slice(b, b + batch);
    const W = Math.min(maxW, Math.max(16, Math.ceil(H * Math.max(...idx.map((i) => ratios[i])))));
    const x = new Float32Array(idx.length * 3 * H * W);
    const widths = idx.map((i, n) => {
      const rw = Math.min(W, Math.max(1, Math.ceil(H * ratios[i])));
      const im = resizeLinear(prepped[i], rw, H);
      for (let ch = 0; ch < 3; ch++) {
        for (let y = 0; y < H; y++) {
          const at = ((n * 3 + ch) * H + y) * W;
          for (let xx = 0; xx < rw; xx++) x[at + xx] = NORM[im.data[y * rw + xx]];
        }
      }
      return rw;
    });
    const res = await models.run(model, x, [idx.length, 3, H, W]);
    const [, T, C] = res.dims;
    idx.forEach((i, n) => {
      out[i] = ctc(res.data, n * T * C, T, C, W / T, widths[n], models.chars);
    });
  }
  return out;
}

/**
 * Reads every box (_read_boxes). A box taller than wide is read as cut and turned both ways, keeping the most
 * confident reading. A line with Latin letters inside Thai words is read again with rec2, when it is loaded.
 */
export async function readBoxes(img: Raster, boxes: Quad[], models: Models): Promise<Reading[]> {
  const raw = boxes.map((q) => cropLine(img, q));
  const tall = raw.flatMap((c, n) => (c.height >= 1.5 * c.width ? [n] : []));
  const turned = ([1, -1] as const).flatMap((k) => tall.map((n) => rot90(raw[n], k)));
  const res = await recognize([...raw, ...turned], models);
  const out = res.slice(0, raw.length);
  tall.forEach((n, j) => {
    for (const alt of [res[raw.length + j], res[raw.length + tall.length + j]]) {
      if (alt.conf > out[n].conf) out[n] = { ...alt, chars: null };
    }
  });
  const sus = models.rec2 ? out.flatMap((r, n) => (r.chars && mixed(r.text) >= CFG.rec2.minMixed ? [n] : [])) : [];
  if (sus.length) {
    const alts = await recognize(sus.map((n) => raw[n]), models, "rec2");
    sus.forEach((n, j) => {
      if (mixed(alts[j].text) < mixed(out[n].text)) out[n] = alts[j];
    });
  }
  return out;
}

/**
 * One line box -> its pieces between blank stretches at least `ratio` times its height, with such a stretch trimmed
 * off either end (split_one). Null when the box stays whole.
 */
export function splitOne(img: Raster, b: Quad, ratio: number): Quad[] | null {
  if (!ratio) return null;
  const c = cropLine(img, b);
  const { width: w, height: h } = c;
  if (w < 4 * h || h < 4) return null;
  const flat = flatten(toGray(c)).data;
  const segs: [number, number][] = [];
  let start = -1, blank = 0;
  for (let x = 0; x < w; x++) {
    let on = false;
    for (let y = 0; y < h && !on; y++) on = flat[y * w + x] < 128;
    if (on) {
      if (start < 0) start = x;
      else if (blank >= ratio * h) {
        segs.push([start, x - blank]);
        start = x;
      }
      blank = 0;
    } else if (start >= 0) blank += 1;
  }
  if (start >= 0) segs.push([start, w - blank]);
  if (!segs.length || (segs.length === 1 && segs[0][0] < ratio * h && w - segs[0][1] < ratio * h)) return null;
  const top = [f32(b[1][0] - b[0][0]), f32(b[1][1] - b[0][1])], bot = [f32(b[2][0] - b[3][0]), f32(b[2][1] - b[3][1])];
  const along = (o: Quad[number], d: number[], t: number): Quad[number] =>
    [f32(o[0] + f32(f32(t) * d[0])), f32(o[1] + f32(f32(t) * d[1]))];
  const pad = 0.15 * h;
  return segs.map(([x0, x1]) => {
    const t0 = Math.max(0, (x0 - pad) / w), t1 = Math.min(1, (x1 + pad) / w);
    return [along(b[0], top, t0), along(b[0], top, t1), along(b[3], bot, t1), along(b[3], bot, t0)];
  });
}
