// Measurements of line boxes shared by the page steps: line_height, page_skew and _vertical from line_engine.

import { type Point, type Quad, median } from "./image";

const f32 = Math.fround;

/** np.linalg.norm(p - q) on float32 corners: a float32 result. */
export function norm(p: Point, q: Point): number {
  const dx = f32(p[0] - q[0]), dy = f32(p[1] - q[1]);
  return f32(Math.sqrt(f32(dx * dx + dy * dy)));
}

/** Box height: its left edge, top-left to bottom-left. */
export const boxHeight = (b: Quad) => norm(b[0], b[3]);
/** Box width: its top edge. */
export const boxWidth = (b: Quad) => norm(b[0], b[1]);

/** Typical line height: the median over boxes at least twice as wide as tall (line_height). */
export function lineHeight(boxes: Quad[]): number {
  if (!boxes.length) return 1;
  const hs = boxes.map((b) => Math.max(boxHeight(b), 1));
  const lines = hs.filter((h, i) => boxWidth(boxes[i]) >= 2 * h);
  return median(lines.length >= 3 ? lines : hs);
}

/** Median text-line angle in degrees, from boxes at least 3 times wider than tall (page_skew). */
export function pageSkew(boxes: Quad[]): number {
  const angles: number[] = [];
  for (const b of boxes) {
    const dx = f32(b[1][0] - b[0][0]), dy = f32(b[1][1] - b[0][1]);
    if (f32(Math.hypot(dx, dy)) >= f32(3 * Math.max(boxHeight(b), 1))) angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
  }
  return angles.length ? median(angles) : 0;
}

/** +1 for a box at least `ratio` times taller than wide, -1 for one that much wider than tall, else 0 (_vertical). */
export function vertical(b: Quad, ratio: number): number {
  const w = boxWidth(b), h = boxHeight(b);
  return h >= ratio * Math.max(w, 1) ? 1 : w >= ratio * Math.max(h, 1) ? -1 : 0;
}
