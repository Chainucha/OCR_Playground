// Page orientation from the text itself, no extra model (LineOCR._sideways and _upside_down), deskew (_deskew), and
// the matrices that map the turned or straightened page back to the image the caller gave (_rot90_matrix).

import { CFG } from "./config";
import { boxHeight, boxWidth, vertical } from "./geometry";
import { type Mat3, type Quad, type Raster, borderMedian, median, roundHalfEven, rot90, warpAffine } from "./image";
import { cropLine, recognize } from "./recognize";
import type { Models, Reading } from "./types";

/** 3x3 map from an image of `width` x `height` to np.rot90(image, k) coordinates (_rot90_matrix). */
export function rot90Matrix(k: 1 | -1 | 2, width: number, height: number): Mat3 {
  if (k === 1) return [0, 1, 0, -1, 0, width - 1, 0, 0, 1];
  if (k === -1) return [0, -1, height - 1, 1, 0, 0, 0, 0, 1];
  return [-1, 0, width - 1, 0, -1, height - 1, 0, 0, 1];
}

/** cv2.getRotationMatrix2D(center, angle, 1) as a 2x3, row-major. */
function rotationMatrix(cx: number, cy: number, angle: number): number[] {
  const a = Math.cos((angle * Math.PI) / 180), b = Math.sin((angle * Math.PI) / 180);
  return [a, b, (1 - a) * cx - b * cy, -b, a, b * cx + (1 - a) * cy];
}

/**
 * The page turned so lines leaning by `angle` degrees run level, on a canvas grown to fit and filled with the page's
 * own border colour (_deskew). Returns the image and the 3x3 map from old to new coordinates.
 */
export function deskew(img: Raster, angle: number): { img: Raster; m: Mat3 } {
  const { width: W, height: H } = img;
  const m = rotationMatrix(W / 2, H / 2, angle);
  const c = Math.abs(m[0]), s = Math.abs(m[1]);
  const nW = Math.trunc(roundHalfEven(H * s + W * c)), nH = Math.trunc(roundHalfEven(H * c + W * s));
  m[2] += nW / 2 - W / 2;
  m[5] += nH / 2 - H / 2;
  return { img: warpAffine(img, m, nW, nH, borderMedian(img)), m: [...m, 0, 0, 1] };
}

/**
 * np.rot90 k that turns a sideways page upright, 0 if it is not sideways: most lines run vertically. The direction is
 * whichever way the longest vertical lines read with more confidence (_sideways).
 */
export async function sideways(img: Raster, boxes: Quad[], models: Models): Promise<0 | 1 | -1> {
  const votes = boxes.map((b) => vertical(b, 2));
  const vert = boxes.filter((_, i) => votes[i] === 1);
  if (vert.length < 3 || vert.length <= votes.filter((v) => v === -1).length) return 0;
  const longest = vert.map((b, i) => ({ b, i, h: boxHeight(b) })).sort((p, q) => q.h - p.h || p.i - q.i);
  const raw = longest.slice(0, CFG.ori.sample).map(({ b }) => cropLine(img, b));
  const res = await recognize(([1, -1] as const).flatMap((k) => raw.map((c) => rot90(c, k))), models);
  const sum = (rs: Reading[]) => rs.reduce((s, r) => s + r.conf, 0);
  return sum(res.slice(0, raw.length)) > sum(res.slice(raw.length)) ? 1 : -1;
}

/** Only for a page that reads badly: do its longest lines read better turned half way (_upside_down)? */
export async function upsideDown(img: Raster, boxes: Quad[], reads: Reading[], models: Models): Promise<boolean> {
  const oc = CFG.ori;
  const confs = reads.filter((r) => [...r.text].length >= 2).map((r) => r.conf);
  if (confs.length < 3 || median(confs) >= oc.flipBelow) return false;
  const idx = reads.map((_, i) => i).filter((i) => vertical(boxes[i], 2) === -1)
    .map((i) => ({ i, w: boxWidth(boxes[i]) })).sort((p, q) => q.w - p.w || p.i - q.i)
    .slice(0, oc.sample).map(({ i }) => i);
  if (idx.length < 3) return false;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const up = mean(idx.map((i) => reads[i].conf));
  const flipped = await recognize(idx.map((i) => rot90(cropLine(img, boxes[i]), 2)), models);
  return mean(flipped.map((r) => r.conf)) > up + oc.flipMargin;
}
