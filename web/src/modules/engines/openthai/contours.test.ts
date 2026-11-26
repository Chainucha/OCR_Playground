import { describe, expect, it } from "vitest";
import { boxPoints, findContours, minAreaRect, offsetPolygon, arcLength, contourArea } from "./contours";
import fixtures from "./det.fixtures.json";
import type { Point } from "./image";

// det.fixtures.json: OpenCV and pyclipper on synthetic probability maps (engines/scripts/det_fixtures.py).
const cases = fixtures.map((c, i) => {
  const prob = new Float32Array(new Uint8Array(Buffer.from(c.prob, "base64")).buffer);
  const bitmap = Uint8Array.from(prob, (p) => Number(p > Math.fround(0.2)));
  return [`map ${i} (${c.w}x${c.h})`, { ...c, bitmap }] as const;
});
const rectOf = (r: ReturnType<typeof minAreaRect>) => [r.cx, r.cy, r.w, r.h, r.angle];

describe("cv2.findContours(RETR_LIST, CHAIN_APPROX_SIMPLE)", () => {
  it.each(cases)("%s: same contours, points and order", (_, c) => {
    expect(findContours(c.bitmap, c.w, c.h)).toEqual(c.steps.map((s) => s.contour));
  });
});

describe("cv2.minAreaRect and cv2.boxPoints", () => {
  it.each(cases)("%s: contour rectangles", (_, c) => {
    for (const s of c.steps) {
      const r = minAreaRect(s.contour as Point[], false);
      expect(rectOf(r)).toEqual(s.rect);
      expect(boxPoints(r)).toEqual(s.box);
    }
  });

  it.each(cases)("%s: rectangles of the unclipped outlines", (_, c) => {
    for (const s of c.steps.filter((x) => x.unclip)) {
      const r = minAreaRect(s.unclip as Point[], true);
      expect(rectOf(r)).toEqual(s.big_rect);
      expect(boxPoints(r)).toEqual(s.big_box);
    }
  });
});

describe("pyclipper round offset", () => {
  it.each(cases)("%s: same outline as _unclip, up to its start point", (_, c) => {
    for (const s of c.steps.filter((x) => x.unclip)) {
      const box = s.box as Point[];
      const got = offsetPolygon(box, (contourArea(box) * 1.4) / arcLength(box));
      const key = (p: number[]) => `${p[0]},${p[1]}`;
      expect(new Set(s.unclip!.map(key)).isSubsetOf(new Set(got.map(key)))).toBe(true);
    }
  });
});

describe("unclip end to end", () => {
  it.each(cases)("%s: minAreaRect of the port's own outline", (_, c) => {
    for (const s of c.steps.filter((x) => x.unclip)) {
      const box = s.box as Point[];
      const r = minAreaRect(offsetPolygon(box, (contourArea(box) * 1.4) / arcLength(box)), true);
      expect(boxPoints(r)).toEqual(s.big_box);
    }
  });
});
