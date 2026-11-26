import { describe, expect, it } from "vitest";
import type { Quad, Raster } from "./image";
import { type Page, attachMarks, fragments } from "./marks";
import type { Models, Reading } from "./types";

const box = (x0: number, y0: number, x1: number, y1: number): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const read = (text: string, conf: number): Reading => ({ text, conf, chars: [] });
const CHARS = ["", "ก", "า", "้", "ข", " "];
const page: Raster = { data: new Uint8Array(200 * 100 * 3).fill(255), width: 200, height: 100, channels: 3 };

/** A recognizer that reads every line it is given as `text`, confidently: one character per frame, blanks between. */
function reads(text: string): Models {
  return {
    chars: CHARS, rec2: false,
    run: async (_model, _input, dims) => {
      const [B] = dims, T = 8, C = CHARS.length;
      const data = new Float32Array(B * T * C);
      for (let b = 0; b < B; b++) {
        for (let t = 0; t < T; t++) {
          const ch = t % 2 ? undefined : [...text][t / 2];
          data[(b * T + t) * C + (ch === undefined ? 0 : CHARS.indexOf(ch))] = 0.97;
        }
      }
      return { data, dims: [B, T, C] };
    },
  };
}

/** Two lines and, above the first, a tone mark the detector boxed on its own and the filter drops. */
const marked = (): Page => ({
  boxes: [box(10, 40, 190, 60), box(10, 70, 190, 90), box(50, 33, 60, 38)],
  reads: [read("กา", 0.95), read("ขา", 0.95), read("้", 0.5)],
  rows: [[2], [0], [1]],
  angle: 0,
});

describe("attachMarks", () => {
  it("puts a floating mark back into the line under it and keeps the new reading", async () => {
    const p = marked();
    const absorbed = await attachMarks(page, p, new Set(), reads("ก้า"));
    expect([...absorbed]).toEqual([2]);
    expect(p.reads[0].text).toBe("ก้า");
    // The line grew up to the mark's top.
    expect(p.boxes[0][0][1]).toBeCloseTo(33, 4);
    expect(p.boxes[1]).toEqual(box(10, 70, 190, 90));
  });

  it("rejects a re-read that changes a letter, not just marks", async () => {
    const p = marked();
    expect((await attachMarks(page, p, new Set(), reads("ข้า"))).size).toBe(0);
    expect(p.reads[0].text).toBe("กา");
    expect(p.boxes[0]).toEqual(box(10, 40, 190, 60));
  });

  it("leaves a page with nothing to drop alone", async () => {
    const p = { ...marked(), boxes: marked().boxes.slice(0, 2), reads: marked().reads.slice(0, 2) };
    expect((await attachMarks(page, p, new Set(), reads("ก้า"))).size).toBe(0);
  });
});

describe("fragments", () => {
  it("finds a short piece touching a full-height line, and nothing else", () => {
    const boxes = [box(10, 40, 190, 60), box(10, 70, 190, 90), box(10, 100, 190, 120), box(50, 61, 55, 66), box(50, 140, 55, 145)];
    const rs = [read("กา", 0.95), read("ขา", 0.95), read("กา", 0.95), read("9/", 0.6), read("9]", 0.6)];
    expect([...fragments(boxes, rs)]).toEqual([3]);
  });
});
