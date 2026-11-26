import { describe, expect, it } from "vitest";
import { pageSkew } from "./geometry";
import { type Quad, type Raster, applyMat, invert3, multiply3, rot90 } from "./image";
import { deskew, rot90Matrix } from "./orient";

// A 4 x 3 grey image whose pixel values are their own index, so each pixel can be found after a turn.
const W = 4, H = 3;
const img: Raster = { data: Uint8Array.from({ length: W * H }, (_, i) => i), width: W, height: H, channels: 1 };
const at = (r: Raster, x: number, y: number) => r.data[y * r.width + x];

describe("rot90Matrix", () => {
  it.each([1, -1, 2] as const)("sends each pixel where np.rot90(k=%i) puts it", (k) => {
    const turned = rot90(img, k);
    const m = rot90Matrix(k, W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [[tx, ty]] = applyMat(m, [[x, y]]);
        expect(at(turned, tx, ty)).toBe(at(img, x, y));
      }
    }
  });

  it("maps a box on the turned page back to the original image", () => {
    // The page was turned clockwise, then half way: back = inverse of the product.
    const tf = multiply3(rot90Matrix(2, H, W), rot90Matrix(-1, W, H));
    const box = [[0, 0], [2, 0], [2, 1], [0, 1]];
    const there = applyMat(tf, box);
    const back = applyMat(invert3(tf), there).map(([x, y]) => [Math.round(x * 1e9) / 1e9 + 0, Math.round(y * 1e9) / 1e9 + 0]);
    expect(back).toEqual(box);
  });
});

describe("deskew", () => {
  const lines = (deg: number): Quad[] => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    // Long lines, 400 x 20, leaning `deg` degrees, stacked down the page.
    return [0, 1, 2, 3, 4].map((n) => {
      const pts = [[0, 0], [400, 0], [400, 20], [0, 20]].map(([x, y]) => [50 + x * c - y * s, 50 + n * 40 + x * s + y * c]);
      return pts.map(([x, y]) => [Math.fround(x), Math.fround(y)]) as Quad;
    });
  };

  it("measures the angle lines lean by", () => {
    expect(pageSkew(lines(5))).toBeCloseTo(5, 4);
    expect(pageSkew(lines(-3))).toBeCloseTo(-3, 4);
  });

  it("ignores boxes that are not line-shaped", () => {
    const words: Quad[] = [[[0, 0], [30, 5], [28, 25], [-2, 20]]];
    expect(pageSkew([...lines(0), ...words, ...words, ...words, ...words, ...words, ...words])).toBe(0);
  });

  it("turns the page so leaning lines run level, on a canvas grown to fit", () => {
    const page: Raster = { data: new Uint8Array(500 * 300 * 3).fill(255), width: 500, height: 300, channels: 3 };
    const { img: out, m } = deskew(page, 5);
    expect([out.width, out.height]).toEqual([524, 342]);
    // The lines' corners land level: both ends of each top edge at the same height.
    for (const b of lines(5)) {
      const [p, q] = applyMat(m, [b[0], b[1]]);
      expect(q[1] - p[1]).toBeCloseTo(0, 3);
    }
    // The new corners are filled with the page's border colour.
    expect(Array.from(out.data.subarray(0, 3))).toEqual([255, 255, 255]);
  });
});
