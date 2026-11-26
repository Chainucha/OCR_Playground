// The OpenCV and Clipper geometry behind DB text detection, matching opencv-python 5.1 and pyclipper 1.4 bit for bit:
// cv2.findContours (RETR_LIST, CHAIN_APPROX_SIMPLE), cv2.convexHull, cv2.minAreaRect, cv2.boxPoints,
// cv2.contourArea, cv2.arcLength and pyclipper's round offset. contours.test.ts checks them against Python's output.

import type { Point, Quad } from "./image";

const f32 = Math.fround;
const sign = (v: number) => (v > 0 ? 1 : 0) - (v < 0 ? 1 : 0);

// Chain code steps: right, up-right, up, up-left, left, down-left, down, down-right (contours_common.hpp).
const STEP: Point[] = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
const RIGHT = -126; // a pixel marked as the right edge of a border: 2 | 0x80 as a signed byte
const NEW = 2;

/**
 * cv2.findContours(bitmap, RETR_LIST, CHAIN_APPROX_SIMPLE): Suzuki's border following on the image with a 1-pixel
 * border, outer borders and hole borders alike, in the order OpenCV returns them (last found first).
 */
export function findContours(bitmap: Uint8Array, width: number, height: number): Point[][] {
  const W = width + 2, H = height + 2;
  const img = new Int8Array(W * H);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (bitmap[y * width + x]) img[(y + 1) * W + x + 1] = 1;
  }
  const delta = STEP.map(([dx, dy]) => dx + dy * W);
  const found: Point[][] = [];
  for (let y = 1; y < H - 1; y++) {
    let prev = 0;
    for (let x = 1; x < W - 1; x++) {
      const p = img[y * W + x];
      if (p === prev) continue;
      const hole = p === 0 && prev >= 1;
      if (!(prev === 0 && p === 1) && !hole) {
        prev = p;
        continue;
      }
      const sx = hole ? x - 1 : x;
      found.push(trace(img, delta, y * W + sx, [sx - 1, y - 1], hole));
      prev = img[y * W + x];
    }
  }
  return found.reverse();
}

/** icvFetchContourEx: one border from its start pixel, keeping the points where the direction changes. */
function trace(img: Int8Array, delta: number[], i0: number, start: Point, hole: boolean): Point[] {
  let pt = start;
  const pts: Point[] = [];
  let s = hole ? 0 : 4;
  let sEnd = s;
  let i1 = i0;
  do {
    s = (s - 1) & 7;
    i1 = i0 + delta[s];
  } while (img[i1] === 0 && s !== sEnd);
  if (s === sEnd) {
    img[i0] = RIGHT;
    return [pt];
  }
  let i3 = i0, i4 = i0;
  let prevS = s ^ 4;
  for (;;) {
    sEnd = s;
    while (s < 15) {
      s += 1;
      i4 = i3 + delta[s & 7];
      if (img[i4] !== 0) break;
    }
    s &= 7;
    if (s >= 1 && s - 1 < sEnd) img[i3] = RIGHT;
    else if (img[i3] === 1) img[i3] = NEW;
    if (s !== prevS) pts.push(pt);
    prevS = s;
    pt = [pt[0] + STEP[s][0], pt[1] + STEP[s][1]];
    if (i4 === i0 && i3 === i1) break;
    i3 = i4;
    s = (s + 4) & 7;
  }
  return pts;
}

/** Vec2f normalize: a float32 norm, then each part scaled in double and stored as float32. */
function normalize(x: number, y: number): [number, number] {
  const nv = f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));
  const k = nv ? 1 / nv : 0;
  return [f32(x * k), f32(y * k)];
}

/** One half of the hull, Sklansky's scan (convhull.cpp Sklansky_). `pts` are already sorted. */
function sklansky(pts: Point[], start: number, end: number, stack: number[], at: number, nsign: number, sign2: number, isFloat: boolean): number {
  const incr = end > start ? 1 : -1;
  let pprev = start, pcur = pprev + incr, pnext = pcur + incr;
  let size = 3;
  if (start === end || (pts[start][0] === pts[end][0] && pts[start][1] === pts[end][1])) {
    stack[at] = start;
    return 1;
  }
  stack[at] = pprev;
  stack[at + 1] = pcur;
  stack[at + 2] = pnext;
  const stop = end + incr;
  while (pnext !== stop) {
    const cury = pts[pcur][1], nexty = pts[pnext][1];
    const by = isFloat ? f32(nexty - cury) : nexty - cury;
    if (sign(by) !== nsign) {
      let a: [number, number] = [pts[pcur][0] - pts[pprev][0], cury - pts[pprev][1]];
      let b: [number, number] = [pts[pnext][0] - pts[pcur][0], by];
      if (isFloat) {
        a = normalize(f32(a[0]), f32(a[1]));
        b = normalize(f32(b[0]), b[1]);
      }
      const convexity = a[1] * b[0] - a[0] * b[1];
      if (sign(convexity) === sign2 && (a[0] !== 0 || a[1] !== 0)) {
        pprev = pcur;
        pcur = pnext;
        pnext += incr;
        stack[at + size] = pnext;
        size += 1;
      } else if (pprev === start) {
        pcur = pnext;
        stack[at + 1] = pcur;
        pnext += incr;
        stack[at + 2] = pnext;
      } else {
        stack[at + size - 2] = pnext;
        pcur = pprev;
        pprev = stack[at + size - 4];
        size -= 1;
      }
    } else {
      pnext += incr;
      stack[at + size - 1] = pnext;
    }
  }
  return size - 1;
}

/** cv2.convexHull(points, clockwise=False): hull points in OpenCV's order. */
export function convexHull(points: Point[], isFloat: boolean): Point[] {
  const total = points.length;
  if (!total) return [];
  const order = points.map((_, i) => i).sort(
    (p, q) => points[p][0] - points[q][0] || points[p][1] - points[q][1] || p - q,
  );
  const ptr = order.map((i) => points[i]);
  let miny = 0, maxy = 0;
  for (let i = 1; i < total; i++) {
    const y = ptr[i][1];
    if (ptr[miny][1] > y) miny = i;
    if (ptr[maxy][1] < y) maxy = i;
  }
  const hull: number[] = [];
  const stack = new Array<number>(total + 2).fill(0);
  if (ptr[0][0] === ptr[total - 1][0] && ptr[0][1] === ptr[total - 1][1]) {
    hull.push(0);
  } else {
    // Upper half: one stack runs 0 -> maxy, the other total-1 -> maxy. Counter-clockwise, OpenCV emits the second
    // stack first.
    const leftCount = sklansky(ptr, 0, maxy, stack, 0, -1, 1, isFloat);
    const rightCount = sklansky(ptr, total - 1, maxy, stack, leftCount, -1, -1, isFloat);
    const upperTl = stack.slice(leftCount, leftCount + rightCount), upperTr = stack.slice(0, leftCount);
    const tlCount = rightCount, trCount = leftCount;
    for (let i = 0; i < tlCount - 1; i++) hull.push(upperTl[i]);
    for (let i = trCount - 1; i > 0; i--) hull.push(upperTr[i]);
    const stopIdx = trCount > 2 ? upperTr[1] : tlCount > 2 ? upperTl[tlCount - 2] : -1;
    // Lower half.
    const blCount0 = sklansky(ptr, 0, miny, stack, 0, 1, -1, isFloat);
    const brCount0 = sklansky(ptr, total - 1, miny, stack, blCount0, 1, 1, isFloat);
    let blCount = blCount0, brCount = brCount0;
    const bl = stack.slice(0, blCount0), br = stack.slice(blCount0, blCount0 + brCount0);
    if (stopIdx >= 0) {
      const check = blCount > 2 ? bl[1] : blCount + brCount > 2 ? br[2 - blCount] : -1;
      if (check === stopIdx || (check >= 0 && ptr[check][0] === ptr[stopIdx][0] && ptr[check][1] === ptr[stopIdx][1])) {
        blCount = Math.min(blCount, 2);
        brCount = Math.min(brCount, 2);
      }
    }
    for (let i = 0; i < blCount - 1; i++) hull.push(bl[i]);
    for (let i = brCount - 1; i > 0; i--) hull.push(br[i]);
  }
  const idx = hull.map((h) => order[h]);
  const nout = idx.length;
  // Cyclic shift so the original indices run up or down, as OpenCV does.
  if (nout >= 3) {
    let minIdx = 0, maxIdx = 0, lt = 0;
    for (let i = 1; i < nout; i++) {
      lt += Number(idx[i - 1] < idx[i]);
      if (lt > 1 && lt <= i - 2) break;
      if (idx[i] < idx[minIdx]) minIdx = i;
      if (idx[i] > idx[maxIdx]) maxIdx = i;
    }
    const mmdist = Math.abs(maxIdx - minIdx);
    if ((mmdist === 1 || mmdist === nout - 1) && (lt <= 1 || lt >= nout - 2)) {
      const ascending = (maxIdx + 1) % nout === minIdx;
      const i0 = ascending ? minIdx : maxIdx;
      if (i0 > 0) {
        const shifted: number[] = [];
        let j = i0, i = 0;
        for (; i < nout; i++) {
          const cur = idx[j];
          shifted.push(cur);
          const nj = j + 1 < nout ? j + 1 : 0;
          if (i < nout - 1 && ascending !== cur < idx[nj]) break;
          j = nj;
        }
        if (i === nout) idx.splice(0, nout, ...shifted);
      }
    }
  }
  return idx.map((i) => points[i]);
}

export type RotatedRect = { cx: number; cy: number; w: number; h: number; angle: number };

/** rotcalipers.cpp rotatingCalipers(CALIPERS_MINAREARECT): the rectangle's corner and its two sides, in float32. */
function calipers(pts: Point[]): [Point, Point, Point] {
  const n = pts.length;
  const vx = new Array<number>(n), vy = new Array<number>(n), inv = new Array<number>(n);
  let left = 0, bottom = 0, right = 0, top = 0;
  let leftX = pts[0][0], rightX = pts[0][0], topY = pts[0][1], bottomY = pts[0][1];
  let p0 = pts[0];
  for (let i = 0; i < n; i++) {
    if (p0[0] < leftX) [leftX, left] = [p0[0], i];
    if (p0[0] > rightX) [rightX, right] = [p0[0], i];
    if (p0[1] > topY) [topY, top] = [p0[1], i];
    if (p0[1] < bottomY) [bottomY, bottom] = [p0[1], i];
    const p = pts[i + 1 < n ? i + 1 : 0];
    const dx = p[0] - p0[0], dy = p[1] - p0[1];
    vx[i] = f32(dx);
    vy[i] = f32(dy);
    inv[i] = f32(1 / Math.sqrt(dx * dx + dy * dy));
    p0 = p;
  }
  const seq = [bottom, right, top, left];
  let baseA = 1, baseB = 0;
  let minArea = 3.4028234663852886e38;
  let best = { left: 0, a: 0, width: 0, b: 0, height: 0, bottom: 0 };
  // The four caliper sides, each turned to the first side's direction.
  const rotated = (k: number): Point => {
    const x = vx[seq[k]], y = vy[seq[k]];
    return k === 0 ? [x, y] : k === 1 ? [y, -x] : k === 2 ? [-x, -y] : [-y, x];
  };
  const isRight = (v1: Point, v2: Point) => f32(f32(v1[1] * v2[0]) + f32(-v1[0] * v2[1])) < 0;
  for (let k = 0; k < n; k++) {
    let main = 0;
    const rv = [rotated(0), rotated(1), rotated(2), rotated(3)];
    for (let i = 1; i < 4; i++) if (isRight(rv[i], rv[main])) main = i;
    const pi = seq[main];
    const lx = f32(vx[pi] * inv[pi]), ly = f32(vy[pi] * inv[pi]);
    [baseA, baseB] = main === 0 ? [lx, ly] : main === 1 ? [ly, -lx] : main === 2 ? [-lx, -ly] : [-ly, lx];
    seq[main] = seq[main] + 1 === n ? 0 : seq[main] + 1;
    let dx = f32(pts[seq[1]][0] - pts[seq[3]][0]), dy = f32(pts[seq[1]][1] - pts[seq[3]][1]);
    const width = f32(f32(dx * baseA) + f32(dy * baseB));
    dx = f32(pts[seq[2]][0] - pts[seq[0]][0]);
    dy = f32(pts[seq[2]][1] - pts[seq[0]][1]);
    const height = f32(f32(-dx * baseB) + f32(dy * baseA));
    const area = f32(width * height);
    if (area <= minArea) {
      minArea = area;
      best = { left: seq[3], a: baseA, width, b: baseB, height, bottom: seq[0] };
    }
  }
  const A1 = best.a, B1 = best.b, A2 = -best.b, B2 = best.a;
  const pl = pts[best.left], pb = pts[best.bottom];
  const C1 = f32(f32(A1 * pl[0]) + f32(pl[1] * B1));
  const C2 = f32(f32(A2 * pb[0]) + f32(pb[1] * B2));
  const idet = f32(1 / f32(f32(A1 * B2) - f32(A2 * B1)));
  const px = f32(f32(f32(C1 * B2) - f32(C2 * B1)) * idet);
  const py = f32(f32(f32(A1 * C2) - f32(A2 * C1)) * idet);
  return [[px, py], [f32(A1 * best.width), f32(B1 * best.width)], [f32(A2 * best.height), f32(B2 * best.height)]];
}

/** cv2.minAreaRect(points). `isFloat` says whether OpenCV sees float32 points (the hull test normalises then). */
export function minAreaRect(points: Point[], isFloat: boolean): RotatedRect {
  const hp = convexHull(points, isFloat).map(([x, y]) => [f32(x), f32(y)] as Point);
  let angle = -Math.PI / 2;
  const box = { cx: 0, cy: 0, w: 0, h: 0, angle: 0 };
  const n = hp.length;
  if (n > 2) {
    const [o0, o1, o2] = calipers(hp);
    box.cx = f32(o0[0] + f32(f32(o1[0] + o2[0]) * 0.5));
    box.cy = f32(o0[1] + f32(f32(o1[1] + o2[1]) * 0.5));
    box.w = f32(Math.sqrt(o2[0] * o2[0] + o2[1] * o2[1]));
    box.h = f32(Math.sqrt(o1[0] * o1[0] + o1[1] * o1[1]));
    if (o1[0] === 0 && o1[1] > 0) [box.w, box.h] = [box.h, box.w];
    else angle = -Math.atan2(o1[0], o1[1]);
  } else if (n === 2) {
    box.cx = f32(f32(hp[0][0] + hp[1][0]) * 0.5);
    box.cy = f32(f32(hp[0][1] + hp[1][1]) * 0.5);
    const dx = hp[0][0] - hp[1][0], dy = hp[0][1] - hp[1][1];
    box.h = f32(Math.sqrt(dx * dx + dy * dy));
    if (dx === 0) [box.w, box.h] = [box.h, box.w];
    else if (dy < 0) {
      angle = Math.atan2(dy, dx);
      [box.w, box.h] = [box.h, box.w];
    } else if (dy > 0) angle = -Math.atan2(dx, dy);
  } else if (n === 1) {
    [box.cx, box.cy] = hp[0];
  }
  box.angle = f32((angle * 180) / Math.PI);
  return box;
}

/** cv2.boxPoints (RotatedRect::points in OpenCV 5), then line_engine.order_points. */
export function boxPoints(r: RotatedRect): Quad {
  const ang = (r.angle * Math.PI) / 180;
  const b = f32(f32(Math.cos(ang)) * 0.5), a = f32(f32(Math.sin(ang)) * 0.5);
  const ah = f32(a * r.h), aw = f32(a * r.w), bh = f32(b * r.h), bw = f32(b * r.w);
  const pts: Point[] = [
    [f32(f32(r.cx - ah) - bw), f32(f32(r.cy + bh) - aw)],
    [f32(f32(r.cx + ah) - bw), f32(f32(r.cy - bh) - aw)],
    [f32(f32(r.cx + ah) + bw), f32(f32(r.cy - bh) + aw)],
    [f32(f32(r.cx - ah) + bw), f32(f32(r.cy + bh) + aw)],
  ];
  // np.argsort on 4 values sorts stably.
  pts.sort((p, q) => p[0] - q[0]);
  const [l0, l1] = pts.slice(0, 2).sort((p, q) => p[1] - q[1]);
  const [r0, r1] = pts.slice(2).sort((p, q) => p[1] - q[1]);
  return [l0, r0, r1, l1];
}

/** cv2.contourArea(points), unsigned. */
export function contourArea(pts: Point[]): number {
  let a = 0;
  let prev = pts[pts.length - 1];
  for (const p of pts) {
    a += prev[0] * p[1] - prev[1] * p[0];
    prev = p;
  }
  return Math.abs(a * 0.5);
}

/** cv2.arcLength(points, closed=True) on float32 points: each side's length in float32, summed in double. */
export function arcLength(pts: Point[]): number {
  let total = 0;
  let prev = pts[pts.length - 1];
  for (const p of pts) {
    const dx = f32(p[0] - prev[0]), dy = f32(p[1] - prev[1]);
    total += f32(Math.sqrt(f32(f32(dx * dx) + f32(dy * dy))));
    prev = p;
  }
  return total;
}

/** Clipper's Round: halves away from zero. */
const cround = (v: number) => (v < 0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));

/**
 * pyclipper.PyclipperOffset().AddPath(path, JT_ROUND, ET_CLOSEDPOLYGON); Execute(delta) for a positive delta: the
 * corners truncated to integers as pyclipper does, the outline offset with round joins (arc tolerance 0.25). Clipper's
 * closing union only drops repeated and collinear points; minAreaRect does not depend on them.
 */
export function offsetPolygon(path: Point[], delta: number): Point[] {
  let src: Point[] = [];
  for (const [x, y] of path) {
    const p: Point = [Math.trunc(x), Math.trunc(y)];
    if (!src.length || src[src.length - 1][0] !== p[0] || src[src.length - 1][1] !== p[1]) src.push(p);
  }
  while (src.length > 1 && src[0][0] === src[src.length - 1][0] && src[0][1] === src[src.length - 1][1]) src.pop();
  if (src.length < 3) return [];
  // FixOrientations: reversed when Clipper's Area (minus half this sum) is negative.
  let sum = 0;
  for (let i = 0, j = src.length - 1; i < src.length; j = i++) sum += (src[j][0] + src[i][0]) * (src[j][1] - src[i][1]);
  if (sum > 0) src = src.reverse();
  const len = src.length;
  const tol = Math.min(0.25, Math.abs(delta) * 0.25);
  let steps = Math.PI / Math.acos(1 - tol / Math.abs(delta));
  if (steps > Math.abs(delta) * Math.PI) steps = Math.abs(delta) * Math.PI;
  const sin = Math.sin((2 * Math.PI) / steps), cos = Math.cos((2 * Math.PI) / steps);
  const stepsPerRad = steps / (2 * Math.PI);
  const normals: Point[] = src.map((p, j) => {
    const q = src[(j + 1) % len];
    if (q[0] === p[0] && q[1] === p[1]) return [0, 0];
    let dx = q[0] - p[0], dy = q[1] - p[1];
    const f = 1 / Math.sqrt(dx * dx + dy * dy);
    dx *= f;
    dy *= f;
    return [dy, -dx];
  });
  const out: Point[] = [];
  let k = len - 1;
  for (let j = 0; j < len; j++) {
    const [nkx, nky] = normals[k], [njx, njy] = normals[j], [sx, sy] = src[j];
    let sinA = nkx * njy - njx * nky;
    let done = false;
    if (Math.abs(sinA * delta) < 1) {
      if (nkx * njx + njy * nky > 0) {
        out.push([cround(sx + nkx * delta), cround(sy + nky * delta)]);
        done = true;
      }
    } else if (sinA > 1) sinA = 1;
    else if (sinA < -1) sinA = -1;
    if (!done) {
      if (sinA * delta < 0) {
        out.push([cround(sx + nkx * delta), cround(sy + nky * delta)], [sx, sy], [cround(sx + njx * delta), cround(sy + njy * delta)]);
      } else {
        const a = Math.atan2(sinA, nkx * njx + nky * njy);
        const n = Math.max(cround(stepsPerRad * Math.abs(a)), 1);
        let X = nkx, Y = nky;
        for (let i = 0; i < n; i++) {
          out.push([cround(sx + X * delta), cround(sy + Y * delta)]);
          const X2 = X;
          X = X * cos - sin * Y;
          Y = X2 * sin + Y * cos;
        }
        out.push([cround(sx + njx * delta), cround(sy + njy * delta)]);
      }
      k = j;
    }
  }
  return out;
}
