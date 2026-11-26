// Floating marks: boxes that are pieces of a neighbouring line (_fragments), and tone marks and upper vowels the
// detector boxed apart from their line, put back into it before the line is read again (_attach_marks).

import { CFG } from "./config";
import { boxHeight, lineHeight } from "./geometry";
import { type Point, type Quad, type Raster, median } from "./image";
import { readBoxes } from "./recognize";
import { base, clean, digits, dropReason } from "./text";
import type { Models, Reading } from "./types";

const f32 = Math.fround;

/** The page as _page returns it: boxes, their readings, rows of box indices and the text angle. */
export type Page = { boxes: Quad[]; reads: Reading[]; rows: number[][]; angle: number };

/**
 * Boxes that are pieces of a neighbouring line: at most 3 characters, under 35 % of the page's line height, and
 * touching a full-height line above or below (_fragments). Read alone they come out as junk ("9/", "9]").
 */
export function fragments(boxes: Quad[], reads: Reading[]): Set<number> {
  const out = new Set<number>();
  if (boxes.length < 3) return out;
  const hs = boxes.map(boxHeight);
  const hmed = lineHeight(boxes);
  const xs = (b: Quad) => b.map((p) => p[0]), ys = (b: Quad) => b.map((p) => p[1]);
  boxes.forEach((b, i) => {
    if (hs[i] >= 0.35 * hmed || (reads[i]?.text ?? "").replaceAll(" ", "").length > 3) return;
    const x0 = Math.min(...xs(b)), x1 = Math.max(...xs(b)), y0 = Math.min(...ys(b)), y1 = Math.max(...ys(b));
    for (let j = 0; j < boxes.length; j++) {
      const c = boxes[j];
      if (j === i || hs[j] < 0.6 * hmed) continue;
      if (Math.min(...xs(c)) <= x1 && x0 <= Math.max(...xs(c))
          && Math.min(Math.abs(y0 - Math.max(...ys(c))), Math.abs(Math.min(...ys(c)) - y1)) <= 0.5 * hmed) {
        out.add(i);
        return;
      }
    }
  });
  return out;
}

type Frame = { o: Point; u: Point; v: Point; w: number; h: number };

/**
 * Floating Thai marks (old letterpress books, some display fonts): a box the line filter would drop anyway, lying
 * within marks.max_gap line heights above or below a kept line it overlaps, is absorbed into the nearest such line.
 * That line grows by the marks' reach and is read again; the new reading replaces the old one if it still passes the
 * filter and changes only marks (or, on a page whose typeface floats its marks, no digit). When enough lines had
 * marks, every other line grows by the typical reach too. Mutates `page` and returns the absorbed box indices.
 */
export async function attachMarks(img: Raster, page: Page, frag: Set<number>, models: Models): Promise<Set<number>> {
  const mc = CFG.marks;
  const { boxes, reads } = page;
  const n = boxes.length;
  const hAll = n ? lineHeight(boxes) : 1;
  const junk = boxes.map((b, i) => frag.has(i) || dropReason(clean(reads[i].text), reads[i].conf, boxHeight(b) / hAll) !== null);
  if (!junk.some(Boolean) || junk.every(Boolean)) return new Set();
  const hmed = lineHeight(boxes.filter((_, i) => !junk[i]));
  const frame = new Map<number, Frame>();
  for (let a = 0; a < n; a++) {
    if (junk[a]) continue;
    const b = boxes[a];
    const wa = Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]), ha = Math.hypot(b[3][0] - b[0][0], b[3][1] - b[0][1]);
    if (wa >= 1 && ha >= 0.5 * hmed) {
      frame.set(a, {
        o: b[0], u: [(b[1][0] - b[0][0]) / wa, (b[1][1] - b[0][1]) / wa], v: [(b[3][0] - b[0][0]) / ha, (b[3][1] - b[0][1]) / ha], w: wa, h: ha,
      });
    }
  }
  if (!frame.size) return new Set();
  // Box j in line a's frame: along the line (s) and across it (t).
  const proj = (a: number, j: number) => {
    const { o, u, v } = frame.get(a)!;
    const s = boxes[j].map(([x, y]) => (x - o[0]) * u[0] + (y - o[1]) * u[1]);
    const t = boxes[j].map(([x, y]) => (x - o[0]) * v[0] + (y - o[1]) * v[1]);
    return [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)];
  };
  const reach = new Map<number, [number, number]>([...frame.keys()].map((a) => [a, [0, 0]]));
  const owner = new Map<number, number>();
  for (let j = 0; j < n; j++) {
    if (!junk[j]) continue;
    let best: { gap: number; side: number; a: number; ext: number } | null = null;
    for (const [a, { w: wa, h: ha }] of frame) {
      const [s0, s1, t0, t1] = proj(a, j);
      if (t1 - t0 > mc.maxHeight * ha || Math.min(s1, wa) - Math.max(s0, 0) < 0.5 * (s1 - s0)) continue;
      let gap: number, side: number, ext: number;
      if (t1 <= 0.5 * ha) [gap, side, ext] = [Math.max(0, -t1), 0, -t0];
      else if (t0 >= 0.5 * ha) [gap, side, ext] = [Math.max(0, t0 - ha), 1, t1 - ha];
      else continue; // across the line's middle: part of the line, not a mark
      if (gap > mc.maxGap * ha || ext > mc.maxExt * ha) continue;
      if (!best || gap < best.gap || (gap === best.gap && side < best.side)) best = { gap, side, a, ext };
    }
    if (best) {
      owner.set(j, best.a);
      const r = reach.get(best.a)!;
      r[best.side] = Math.max(r[best.side], best.ext);
    }
  }
  if (!owner.size) return new Set();
  let floating = false; // the page's typeface floats its marks
  for (const side of [0, 1]) {
    const lifted = [...frame.keys()].filter((a) => reach.get(a)![side] > 0);
    if (lifted.length < Math.max(mc.pageMin, mc.pageShare * frame.size)) continue;
    floating = true;
    const typ = median(lifted.map((a) => reach.get(a)![side] / frame.get(a)!.h));
    for (const [a, { w: wa, h: ha }] of frame) {
      if (reach.get(a)![side] > 0) continue;
      let room = typ * ha;
      for (const b of frame.keys()) {
        // Stop short of the neighbouring line's core.
        if (b === a) continue;
        const [s0, s1, t0, t1] = proj(a, b);
        if (Math.min(s1, wa) - Math.max(s0, 0) <= 0) continue;
        if (side === 0 && t1 <= 0.5 * ha) room = Math.min(room, Math.max(0, -t1 * 0.9));
        else if (side === 1 && t0 >= 0.5 * ha) room = Math.min(room, Math.max(0, (t0 - ha) * 0.9));
      }
      reach.get(a)![side] = room;
    }
  }
  const grown: number[] = [], newBoxes: Quad[] = [];
  for (const [a, { v, h: ha }] of frame) {
    const [up, down] = reach.get(a)!;
    if (up <= 0 && down <= 0) continue;
    const b = boxes[a].map(([x, y]) => [x, y]);
    if (up > 0) for (const i of [0, 1]) b[i] = [b[i][0] - v[0] * (up + mc.margin * ha), b[i][1] - v[1] * (up + mc.margin * ha)];
    if (down > 0) for (const i of [2, 3]) b[i] = [b[i][0] + v[0] * (down + mc.margin * ha), b[i][1] + v[1] * (down + mc.margin * ha)];
    grown.push(a);
    newBoxes.push(b.map(([x, y]) => [
      f32(Math.min(Math.max(x, 0), img.width - 1)), f32(Math.min(Math.max(y, 0), img.height - 1)),
    ]) as Quad);
  }
  const done = new Set<number>();
  const res = newBoxes.length ? await readBoxes(img, newBoxes, models) : [];
  grown.forEach((a, k) => {
    const r = res[k];
    const fresh = clean(r.text);
    if (dropReason(fresh, r.conf) !== null) return;
    // Noise taken for a mark must not change the line: only marks may change, or on a floating page no digit.
    const old = clean(reads[a].text);
    if (mc.keepBase && (floating ? digits(fresh) !== digits(old) : base(fresh) !== base(old))) return;
    boxes[a] = newBoxes[k];
    reads[a] = r;
    done.add(a);
  });
  // Marks count as absorbed only where their line was read again.
  return new Set([...owner].filter(([, a]) => done.has(a)).map(([j]) => j));
}
