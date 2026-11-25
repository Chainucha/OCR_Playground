// Probability map -> text-line quads: DB post-processing as line_engine.LineOCR._detect_at does it.

import type { Point, Quad } from "./image";

// det.yml PostProcess overrides the runtime defaults: thresh 0.2, box_thresh 0.4, unclip_ratio 1.4.
export const DET = { limit: 1280, thresh: 0.2, boxThresh: 0.4, unclip: 1.4, minSize: 3, maxCandidates: 3000 };

type Rect = { cx: number; cy: number; w: number; h: number; angle: number };

/** Python's round(): halves go to the even neighbour. */
export function roundHalfEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 ? r - 1 : r;
}

/** Pixel sets of the 8-connected regions above the threshold; their hulls equal those of cv2.findContours' outlines. */
function regions(prob: Float32Array, w: number, h: number): Point[][] {
  const seen = new Uint8Array(w * h);
  const out: Point[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || prob[start] <= DET.thresh) continue;
    const pts: Point[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      pts.push([x, y]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, j = ny * w + nx;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[j] || prob[j] <= DET.thresh) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push(pts);
  }
  return out;
}

function hull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** cv2.minAreaRect by rotating calipers over the hull's edges. */
function minAreaRect(points: Point[]): Rect {
  const hp = hull(points);
  if (hp.length === 1) return { cx: hp[0][0], cy: hp[0][1], w: 0, h: 0, angle: 0 };
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hp.length; i++) {
    const [ax, ay] = hp[i], [bx, by] = hp[(i + 1) % hp.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [px, py] of hp) {
      const u = px * ux + py * uy, v = -px * uy + py * ux;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      best = { cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, w: maxU - minU, h: maxV - minV, angle: Math.atan2(uy, ux) };
    }
  }
  return best!;
}

/** cv2.boxPoints then line_engine.order_points: corners as top-left, top-right, bottom-right, bottom-left. */
function corners(r: Rect): Quad {
  const c = Math.cos(r.angle), s = Math.sin(r.angle), hw = r.w / 2, hh = r.h / 2;
  const pts: Point[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [r.cx + u * c - v * s, r.cy + u * s + v * c]);
  pts.sort((a, b) => a[0] - b[0]);
  const [l0, l1] = pts.slice(0, 2).sort((a, b) => a[1] - b[1]);
  const [r0, r1] = pts.slice(2).sort((a, b) => a[1] - b[1]);
  return [l0, r0, r1, l1];
}

/** Mean probability inside the quad (cv2.fillPoly mask on truncated corners, then cv2.mean). */
function boxScore(prob: Float32Array, w: number, h: number, q: Quad): number {
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = clamp(Math.floor(Math.min(...xs)), w - 1), x1 = clamp(Math.ceil(Math.max(...xs)), w - 1);
  const y0 = clamp(Math.floor(Math.min(...ys)), h - 1), y1 = clamp(Math.ceil(Math.max(...ys)), h - 1);
  const poly = q.map(([x, y]) => [Math.trunc(x - x0), Math.trunc(y - y0)]);
  const inside = (px: number, py: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % 4];
      const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (cr === 0) continue;
      if (sign && Math.sign(cr) !== sign) return false;
      sign = Math.sign(cr);
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
 * Line quads in page coordinates from the detector's probability map. `scale` maps map pixels to padded-page pixels
 * and `pad` is the white border that was added before detection.
 */
export function boxesFromMap(
  prob: Float32Array, mw: number, mh: number,
  page: { width: number; height: number; pad: number; sx: number; sy: number },
): Quad[] {
  const boxes: Quad[] = [];
  for (const pts of regions(prob, mw, mh).slice(0, DET.maxCandidates)) {
    const rect = minAreaRect(pts);
    if (Math.min(rect.w, rect.h) < DET.minSize || boxScore(prob, mw, mh, corners(rect)) < DET.boxThresh) continue;
    // DB's unclip grows the box by area * ratio / perimeter on every side, after pyclipper truncates its corners to
    // integers. The minimum-area rectangle of that rounded offset outline is the truncated box's own minimum-area
    // rectangle with each side 2 * offset longer.
    const offset = (rect.w * rect.h * DET.unclip) / (2 * (rect.w + rect.h));
    const cut = minAreaRect(corners(rect).map(([x, y]) => [Math.trunc(x), Math.trunc(y)]));
    const big = { ...cut, w: cut.w + 2 * offset, h: cut.h + 2 * offset };
    if (Math.min(big.w, big.h) < DET.minSize + 2) continue;
    const q = corners(big).map(([x, y]) => [
      Math.min(Math.max(x * page.sx - page.pad, 0), page.width - 1),
      Math.min(Math.max(y * page.sy - page.pad, 0), page.height - 1),
    ]) as Quad;
    const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
    if (Math.max(...xs) - Math.min(...xs) >= 2 && Math.max(...ys) - Math.min(...ys) >= 2) boxes.push(q);
  }
  return boxes;
}
