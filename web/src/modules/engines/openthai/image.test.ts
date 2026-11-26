import { describe, expect, it } from "vitest";
import fixtures from "./cv.fixtures.json";
import { type Quad, type Raster, resizeLinear, rot90, toGray, warpAffine, warpQuad } from "./image";

// cv.fixtures.json holds OpenCV 5.1's output on small random images (engines/scripts/cv_fixtures.py).
type Enc = { h: number; w: number; c: number; data: string };
const raster = (e: Enc): Raster => ({
  data: new Uint8Array(Buffer.from(e.data, "base64")), width: e.w, height: e.h, channels: e.c as 1 | 3,
});
const mismatches = (got: Raster, want: Enc) => {
  const w = raster(want);
  expect([got.width, got.height, got.channels]).toEqual([w.width, w.height, w.channels]);
  return got.data.reduce((n, v, i) => n + Number(v !== w.data[i]), 0);
};

describe("OpenCV operations, bit for bit", () => {
  it.each(fixtures.resize.map((t) => [`${t.src.w}x${t.src.h}x${t.src.c} -> ${t.w}x${t.h}`, t] as const))(
    "cv2.resize INTER_LINEAR %s",
    (_, t) => expect(mismatches(resizeLinear(raster(t.src), t.w, t.h), t.out)).toBe(0),
  );

  it.each(fixtures.warp.map((t, i) => [i, t] as const))("cv2.warpPerspective INTER_CUBIC, case %i", (_, t) => {
    const quad = t.quad.map(([x, y]) => [Math.fround(x), Math.fround(y)]) as Quad;
    expect(mismatches(warpQuad(raster(t.src), quad, t.w, t.h), t.out)).toBe(0);
  });

  it.each(fixtures.affine.map((t, i) => [i, t] as const))("cv2.warpAffine INTER_CUBIC, case %i", (_, t) => {
    expect(mismatches(warpAffine(raster(t.src), t.m.flat(), t.w, t.h, t.fill), t.out)).toBe(0);
  });

  it("cv2.cvtColor BGR2GRAY", () => {
    const t = fixtures.gray[0];
    expect(mismatches(toGray(raster(t.src)), t.out)).toBe(0);
  });
});

describe("rot90", () => {
  // 2 x 3 image, pixels numbered row by row: 0 1 2 / 3 4 5.
  const img: Raster = { data: Uint8Array.from([0, 1, 2, 3, 4, 5]), width: 3, height: 2, channels: 1 };

  it("turns a quarter counter-clockwise like np.rot90(k=1)", () => {
    expect(Array.from(rot90(img, 1).data)).toEqual([2, 5, 1, 4, 0, 3]);
  });

  it("turns a quarter clockwise like np.rot90(k=-1)", () => {
    expect(Array.from(rot90(img, -1).data)).toEqual([3, 0, 4, 1, 5, 2]);
  });

  it("turns half way", () => {
    expect(Array.from(rot90(img, 2).data)).toEqual([5, 4, 3, 2, 1, 0]);
  });
});
