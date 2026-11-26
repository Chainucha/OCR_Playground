// Text-line detection: LineOCR.detect and _detect_at. The page is padded, scaled to the detector's working size, run
// through det.onnx, and the probability map's regions become line quads (DB post-processing).

import { CFG } from "./config";
import { arcLength, boxPoints, contourArea, findContours, minAreaRect, offsetPolygon } from "./contours";
import { lineHeight } from "./geometry";
import { type Quad, type Raster, padWhite, resizeLinear, roundHalfEven } from "./image";
import type { RunModel } from "./types";

const f32 = Math.fround;
const MEAN = [0.485, 0.456, 0.406].map(f32), STD = [0.229, 0.224, 0.225].map(f32);
// (pixel / 255 - mean) / std per channel, in float32 as NumPy computes it.
const NORM = MEAN.map((m, c) => Float32Array.from({ length: 256 }, (_, v) => f32(f32(f32(v / 255) - m) / STD[c])));

/** Mean probability inside the quad: cv2.fillPoly on the truncated corners, then cv2.mean (_box_score). */
export function boxScore(prob: Float32Array, w: number, h: number, q: Quad): number {
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = clamp(Math.floor(Math.min(...xs)), w - 1), x1 = clamp(Math.ceil(Math.max(...xs)), w - 1);
  const y0 = clamp(Math.floor(Math.min(...ys)), h - 1), y1 = clamp(Math.ceil(Math.max(...ys)), h - 1);
  const poly = q.map(([x, y]) => [Math.trunc(x - x0), Math.trunc(y - y0)]);
  const inside = (px: number, py: number) => {
    let side = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % 4];
      const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (cr === 0) continue;
      if (side && Math.sign(cr) !== side) return false;
      side = Math.sign(cr);
    }
    return true;
  };
  let sum = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x - x0, y - y0)) continue;
      sum += prob[y * w + x];
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Line quads in page coordinates from the detector's probability map (the loop in _detect_at). `sx` and `sy` map
 * map pixels to padded-page pixels and `pad` is the white border added before detection.
 */
export function boxesFromMap(
  prob: Float32Array, mw: number, mh: number,
  page: { width: number; height: number; pad: number; sx: number; sy: number },
): Quad[] {
  const c = CFG.det;
  const thresh = f32(c.thresh);
  const bitmap = Uint8Array.from(prob, (p) => Number(p > thresh));
  const sx = f32(page.sx), sy = f32(page.sy);
  const W1 = page.width - 1, H1 = page.height - 1;
  const clip = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
  const boxes: Quad[] = [];
  for (const cnt of findContours(bitmap, mw, mh).slice(0, c.maxCandidates)) {
    const rect = minAreaRect(cnt, false);
    const core = Math.min(rect.w, rect.h);
    const small = boxPoints(rect);
    if (core < c.minSize || boxScore(prob, mw, mh, small) < c.boxThresh) continue;
    const length = arcLength(small);
    if (length === 0) continue;
    const outline = offsetPolygon(small, (contourArea(small) * c.unclip) / length);
    if (!outline.length) continue;
    const big = minAreaRect(outline, true);
    const side = Math.min(big.w, big.h);
    if (side < c.minSize + 2) continue;
    const box = boxPoints(big);
    let grow = 0;
    if (c.shortPad && Math.hypot(box[0][0] - box[1][0], box[0][1] - box[1][1]) >= Math.hypot(box[0][0] - box[3][0], box[0][1] - box[3][1])) {
      grow = Math.max(0, c.shortPad * (1 + c.unclip) * core - side) / 2;
    }
    let q = box.map(([x, y]) => [clip(f32(f32(x * sx) - page.pad), W1), clip(f32(f32(y * sy) - page.pad), H1)]) as Quad;
    if (grow > 0) {
      // Across the line only: along the left edge's direction (top-left -> bottom-left).
      const vx = q[3][0] - q[0][0], vy = q[3][1] - q[0][1];
      const n = Math.max(Math.hypot(vx, vy), 1e-6);
      const ux = f32((vx / n) * grow * page.sy), uy = f32((vy / n) * grow * page.sy);
      q = q.map(([x, y], i) => {
        const s = i < 2 ? -1 : 1;
        return [clip(f32(x + s * ux), W1), clip(f32(y + s * uy), H1)];
      }) as Quad;
    }
    if (c.vPad) {
      // Thai marks above and below the core band: taller only.
      const hh = Math.max(Math.hypot(q[0][0] - q[3][0], q[0][1] - q[3][1]), 1) * c.vPad / 2;
      q = q.map(([x, y], i) => [x, clip(f32(i < 2 ? y - hh : y + hh), H1)]) as Quad;
    }
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    if (Math.max(...xs) - Math.min(...xs) >= 2 && Math.max(...ys) - Math.min(...ys) >= 2) boxes.push(q);
  }
  return boxes;
}

/** _detect_at: the page padded white, its long side scaled to `limit` in both directions, then det.onnx. */
async function detectAt(img: Raster, limit: number, run: RunModel): Promise<Quad[]> {
  const pad = Math.max(8, Math.trunc(0.05 * Math.min(img.width, img.height)));
  const padded = padWhite(img, pad);
  const { width: w, height: h } = padded;
  const s = limit ? Math.min(limit / Math.max(h, w), 4) : 1;
  const rh = Math.max(32, roundHalfEven((h * s) / 32) * 32), rw = Math.max(32, roundHalfEven((w * s) / 32) * 32);
  const small = resizeLinear(padded, rw, rh);
  const n = rw * rh;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < 3; ch++) x[ch * n + i] = NORM[ch][small.data[i * 3 + ch]];
  }
  const out = await run("det", x, [1, 3, rh, rw]);
  const mh = out.dims[2], mw = out.dims[3];
  return boxesFromMap(out.data, mw, mh, { width: img.width, height: img.height, pad, sx: w / mw, sy: h / mh });
}

/**
 * LineOCR.detect: line quads of a BGR page. With rescan_below on, a page shrunk so far that its lines are under that
 * many detector pixels tall is detected again at a size that makes them about rescan_target pixels.
 */
export async function detect(img: Raster, run: RunModel): Promise<Quad[]> {
  const c = CFG.det;
  let boxes = await detectAt(img, c.limit, run);
  if (c.rescanBelow && c.limit && boxes.length) {
    const pad = Math.max(8, Math.trunc(0.05 * Math.min(img.width, img.height)));
    const s = Math.min(c.limit / Math.max(img.height + 2 * pad, img.width + 2 * pad), 4);
    const hdet = lineHeight(boxes) * s;
    if (s < 1 && hdet < c.rescanBelow) {
      const limit = Math.min(c.rescanMax, (c.limit * c.rescanTarget) / Math.max(hdet, 1));
      if (limit > c.limit * 1.15) boxes = await detectAt(img, limit, run);
    }
  }
  return boxes;
}
