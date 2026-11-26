// Reading order: line_engine.reading_order and its column logic (_blocks, _banded_columns, _prose, _list_pair, ...).
// Rows top to bottom, each left to right, in deskewed coordinates, text columns read one after the other.

import type { ColumnRules } from "./config";
import { boxHeight, lineHeight, pageSkew } from "./geometry";
import { type Quad, median } from "./image";

/** A box's extent in the frame the order is built in: x0, x1, y0, y1. */
type Ext = [number, number, number, number];

const f32 = Math.fround;
const DIGITS = new Set("0123456789๐๑๒๓๔๕๖๗๘๙");
const ENUM = /^\s*\(?([0-9๐-๙]{1,4})\s*[.)]/;
const DIGIT_RUN = /[0-9๐-๙]+/g;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const cy = (e: Ext) => (e[2] + e[3]) / 2;

/** Empty bands between intervals, at least minGap wide (_gaps). */
export function gaps(iv: [number, number][], minGap: number): [number, number][] {
  const s = [...iv].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  let reach = s[0][1];
  for (const [lo, hi] of s.slice(1)) {
    if (lo - reach >= minGap) out.push([reach, lo]);
    reach = Math.max(reach, hi);
  }
  return out;
}

/** The number a line starts with ("12.", "(๓)"), or null (_enum). */
export function enumNumber(text: string): number | null {
  const m = ENUM.exec(text);
  return m ? Number([...m[1]].map((c) => (c >= "๐" && c <= "๙" ? String(c.charCodeAt(0) - 0x0e50) : c)).join("")) : null;
}

/** Share of lines whose first 3 characters (a digit run counted as one) are one of the 2 most common starts. */
export function startRep(lines: string[]): number {
  const st = lines.map((x) => x.trim()).filter(Boolean).map((x) => [...x.replace(DIGIT_RUN, "D")].slice(0, 3).join(""));
  if (!st.length) return 0;
  const counts = new Map<string, number>();
  for (const x of st) counts.set(x, (counts.get(x) ?? 0) + 1);
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, 2);
  return (top[0] + (top[1] ?? 0)) / st.length;
}

type Ctx = { ext: Ext[]; hmed: number; texts: string[] | null; rules: ColumnRules | null };

/** A column of prose: 12+ lines, long for their height, mostly filling the column, few digits, no repeats. */
function prose(col: number[], { ext, hmed, texts }: Ctx): boolean {
  if (col.length < 12) return false;
  const widths = col.map((i) => ext[i][1] - ext[i][0]);
  const span = Math.max(...col.map((i) => ext[i][1])) - Math.min(...col.map((i) => ext[i][0]));
  if (median(widths) < 7 * hmed || mean(widths.map((w) => Number(w >= 0.75 * span))) < 0.35) return false;
  if (texts) {
    const chars = col.flatMap((i) => [...texts[i]].filter((c) => !/\s/.test(c)));
    if (chars.length && chars.filter((c) => DIGITS.has(c)).length > 0.3 * chars.length) return false;
    if (new Set(col.map((i) => texts[i].trim())).size < 0.8 * col.length) return false;
  }
  return true;
}

/** Most facing lines numbered n (left) and n + 1 (right): a list that reads across (_numbered_across). */
function numberedAcross(lcol: number[], rcol: number[], { ext, hmed, texts }: Ctx): boolean {
  if (!texts) return false;
  let pairs = 0;
  for (const i of lcol) {
    const a = enumNumber(texts[i]);
    if (a === null) continue;
    if (rcol.some((j) => enumNumber(texts[j]) === a + 1 && Math.abs(cy(ext[j]) - cy(ext[i])) <= 0.5 * hmed)) pairs += 1;
  }
  return pairs >= 0.5 * Math.min(lcol.length, rcol.length);
}

/** Two sides of a gap that are the columns of a list, read row by row (_list_pair). */
function listPair(lcol: number[], rcol: number[], ctx: Ctx): boolean {
  const { ext, hmed, texts, rules } = ctx;
  if (!rules || !(rules.listRep || rules.listFacing || rules.listEnum) || !lcol.length || !rcol.length) return false;
  if (rules.listRep && texts) {
    if (mean([lcol, rcol].map((col) => startRep(col.map((i) => texts[i])))) >= rules.listRep) return true;
  }
  const [small, other] = lcol.length <= rcol.length ? [lcol, rcol] : [rcol, lcol];
  const ys = other.map((j) => cy(ext[j]));
  const face = mean(small.map((i) => Number(ys.some((c) => Math.abs(cy(ext[i]) - c) <= 0.5 * hmed))));
  const wide = Math.max(...[lcol, rcol].map((col) => median(col.map((i) => ext[i][1] - ext[i][0])))) / hmed;
  if (rules.listFacing && face >= rules.listFacing && wide < (rules.listMaxW ?? 10)) return true;
  if (rules.listEnum && texts && face >= 0.6) return mean(lcol.map((i) => Number(enumNumber(texts[i]) !== null))) >= rules.listEnum;
  return false;
}

/** The column of `side` that touches the gutter: a side can hold several (_next_to). */
function nextTo(side: number[], { ext, hmed }: Ctx, gutterOnRight: boolean): number[] {
  if (!side.length) return side;
  const g = gaps(side.map((i) => [ext[i][0], ext[i][1]]), 0.8 * hmed);
  if (!g.length) return side;
  return gutterOnRight ? side.filter((i) => ext[i][0] >= g[g.length - 1][1]) : side.filter((i) => ext[i][1] <= g[0][0]);
}

const columnPair = (lcol: number[], rcol: number[], ctx: Ctx) =>
  prose(lcol, ctx) && prose(rcol, ctx) && !numberedAcross(lcol, rcol, ctx) && !listPair(lcol, rcol, ctx);

/**
 * Recursive XY-cut into reading-order blocks (_blocks): a vertical cut between two columns of prose first, else the
 * widest horizontal gap, else prose columns that a few wide lines cross (_banded_columns).
 */
function blocks(idx: number[], ctx: Ctx, depth = 0): number[][] {
  const { ext, hmed } = ctx;
  if (idx.length < 6 || depth > 12) return [idx];
  const cuts: [number, number[], number[]][] = [];
  for (const [g0, g1] of gaps(idx.map((i) => [ext[i][0], ext[i][1]]), 0.8 * hmed)) {
    const left = idx.filter((i) => ext[i][1] <= g0), right = idx.filter((i) => ext[i][0] >= g1);
    if (columnPair(nextTo(left, ctx, true), nextTo(right, ctx, false), ctx)) cuts.push([g1 - g0, left, right]);
  }
  if (cuts.length) {
    const [, left, right] = cuts.reduce((best, c) => (c[0] > best[0] ? c : best));
    return [...blocks(left, ctx, depth + 1), ...blocks(right, ctx, depth + 1)];
  }
  const hg = gaps(idx.map((i) => [ext[i][2], ext[i][3]]), 0.8 * hmed);
  if (!hg.length) return bandedColumns(idx, ctx, depth) ?? [idx];
  const [g0, g1] = hg.reduce((best, g) => (g[1] - g[0] > best[1] - best[0] ? g : best));
  const top = idx.filter((i) => ext[i][3] <= g0), bottom = idx.filter((i) => ext[i][2] >= g1);
  return [...blocks(top, ctx, depth + 1), ...blocks(bottom, ctx, depth + 1)];
}

/**
 * Prose columns that a few full-width lines cross: a title over both columns, a footer, a caption (_banded_columns).
 * Each band between crossing lines is read left of the gutter, then right of it, then the crossing line under it.
 */
function bandedColumns(idx: number[], ctx: Ctx, depth: number): number[][] | null {
  const { ext, hmed } = ctx;
  const x0 = Math.min(...idx.map((i) => ext[i][0])), x1 = Math.max(...idx.map((i) => ext[i][1]));
  const wide = idx.filter((i) => ext[i][1] - ext[i][0] >= 0.55 * (x1 - x0));
  if (wide.length > 0.15 * idx.length) return null;
  const wideSet = new Set(wide);
  const rest = idx.filter((i) => !wideSet.has(i));
  if (rest.length < 24) return null;
  const lo = Math.trunc(x0 + 0.15 * (x1 - x0)), n = Math.trunc(0.7 * (x1 - x0)) + 1;
  const cover = new Int32Array(n);
  for (const i of rest) {
    const a = Math.max(0, Math.trunc(ext[i][0]) - lo), b = Math.min(n, Math.ceil(ext[i][1]) - lo);
    for (let x = a; x < b; x++) cover[x] += 1;
  }
  const limit = Math.max(1, Math.trunc(0.03 * rest.length));
  const runs: [number, number][] = [];
  let s = -1;
  for (let x = 0; x <= n; x++) {
    const free = x < n && cover[x] <= limit;
    if (free && s < 0) s = x;
    else if (!free && s >= 0) {
      if (x - s >= 0.4 * hmed) runs.push([lo + s, lo + x]);
      s = -1;
    }
  }
  let best: [number, number, number] | null = null;
  for (const [k, [g0, g1]] of runs.entries()) {
    const left = rest.filter((i) => ext[i][1] <= g0), right = rest.filter((i) => ext[i][0] >= g1);
    // The column on each side ends at the neighbouring gutter (three columns: two gutters).
    const lcol = left.filter((i) => k === 0 || ext[i][0] >= runs[k - 1][1]);
    const rcol = right.filter((i) => k === runs.length - 1 || ext[i][1] <= runs[k + 1][0]);
    if (columnPair(lcol, rcol, ctx) && (best === null || g1 - g0 > best[0])) best = [g1 - g0, g0, g1];
  }
  if (best === null) return null;
  const [, g0, g1] = best;
  const mid = rest.filter((i) => ext[i][0] < g0 && ext[i][1] > g1);
  const midSet = new Set(mid);
  const seps = [...wide, ...mid].sort((p, q) => cy(ext[p]) - cy(ext[q]));
  const centre = (g0 + g1) / 2;
  const out: number[][] = [];
  for (let b = 0; b <= seps.length; b++) {
    const top = b ? cy(ext[seps[b - 1]]) : -Infinity, bottom = b < seps.length ? cy(ext[seps[b]]) : Infinity;
    const band = rest.filter((i) => !midSet.has(i) && top < cy(ext[i]) && cy(ext[i]) <= bottom);
    const cx = (i: number) => (ext[i][0] + ext[i][1]) / 2;
    for (const side of [band.filter((i) => cx(i) < centre), band.filter((i) => cx(i) >= centre)]) {
      if (side.length) out.push(...blocks(side, ctx, depth + 1));
    }
    if (b < seps.length) out.push([seps[b]]);
  }
  return out;
}

const extent = (pts: number[][]): Ext => [
  Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])),
  Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1])),
];

/**
 * Rows top to bottom, each left to right, block by block (reading_order). Boxes are turned by minus the page skew
 * first, so a table row on a page scanned 1 degree off stays one row. `texts` (the recognised lines) let the column
 * test reject lists and number columns.
 */
export function readingOrder(
  boxes: Quad[], angle: number | null = null, texts: string[] | null = null, rules: ColumnRules | null = null,
  columns = true,
): number[][] {
  if (!boxes.length) return [];
  const a = (-(angle ?? pageSkew(boxes)) * Math.PI) / 180;
  const c = f32(Math.cos(a)), s = f32(Math.sin(a));
  // b @ rot.T in float32.
  const ext = boxes.map((b) => extent(b.map(([x, y]) => [f32(f32(x * c) + f32(y * -s)), f32(f32(x * s) + f32(y * c))])));
  const hmed = lineHeight(boxes);
  const idx = boxes.map((_, i) => i);
  let blks = columns ? blocks(idx, { ext, hmed, texts, rules }) : [idx];
  if (columns && a) {
    // The skew can be 1-2 degrees off on a straight page, and a gutter about one em wide is then covered: the
    // unrotated frame is used for the blocks when it finds more of them. Rows are still grouped in the rotated frame.
    const alt = blocks(idx, { ext: boxes.map((b) => extent(b)), hmed, texts, rules });
    if (alt.length > blks.length) blks = alt;
  }
  const cys = ext.map(cy), rx = ext.map((e) => (e[0] + e[1]) / 2);
  const hs = boxes.map((b) => Math.max(boxHeight(b), 1));
  const tol = 0.5 * hmed;
  const rows: number[][] = [];
  for (const blk of blks) {
    // Rows from full-height lines only; small boxes (detached marks, a stray symbol) join the nearest row afterwards.
    let full = blk.filter((i) => hs[i] >= 0.6 * hmed);
    if (!full.length) full = [...blk];
    const fullSet = new Set(full);
    const small = blk.filter((i) => !fullSet.has(i));
    const brows: number[][] = [];
    for (const i of [...full].sort((p, q) => cys[p] - cys[q])) {
      const last = brows[brows.length - 1];
      if (last && Math.abs(cys[i] - mean(last.map((j) => cys[j]))) <= tol) last.push(i);
      else brows.push([i]);
    }
    const centre = brows.map((r) => mean(r.map((j) => cys[j])));
    for (const i of small) {
      const d = centre.map((cc) => Math.abs(cys[i] - cc));
      const k = d.indexOf(Math.min(...d));
      if (d.length && d[k] <= tol + 0.5 * hs[i]) brows[k].push(i);
      else {
        brows.push([i]);
        centre.push(cys[i]);
      }
    }
    const order = brows.map((_, r) => r).sort((p, q) => centre[p] - centre[q]);
    rows.push(...order.map((r) => [...brows[r]].sort((p, q) => rx[p] - rx[q])));
  }
  return rows;
}
