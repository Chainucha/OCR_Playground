// Word boxes cut from the character positions the recognizer reported (line_engine._words and _advance).

import { median } from "./image";
import type { Point, Quad } from "./image";
import { clean } from "./text";
import type { Char } from "./types";

export type Word = { text: string; confidence: number; box: Point[] };

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const MARK = /^\p{Mn}/u;

/**
 * Median distance between consecutive spacing characters inside words, as a share of the line width: the glyph
 * pitch. Marks above and below sit on their base character and are skipped (_advance).
 */
export function advance(tokens: Char[][]): number {
  const steps: number[] = [];
  for (const tok of tokens) {
    const xs = tok.filter((c) => c.ch && !MARK.test(c.ch)).map((c) => c.x0);
    for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) steps.push(xs[i] - xs[i - 1]);
  }
  if (steps.length) return median(steps);
  const n = tokens.reduce((s, t) => s + t.length, 0);
  return tokens.length ? (tokens[tokens.length - 1][tokens[tokens.length - 1].length - 1].x1 - tokens[0][0].x0) / Math.max(n, 1) : 0;
}

/**
 * Words of one line with their boxes (space-separated tokens; Thai runs without spaces stay one token). Each edge is
 * pushed out by half a glyph advance but kept a fifth of an advance clear of the middle of the space, so the boxes
 * leave a visible gap where the space is. Without positions the whole line is one word.
 */
export function words(chars: Char[] | null, box: Quad, text: string, conf: number): Word[] {
  const whole = [{ text, confidence: round4(conf), box: box.map(([x, y]) => [x, y] as Point) }];
  if (!chars?.length) return whole;
  const tokens: Char[][] = [], gaps: number[] = [];
  let cur: Char[] = [];
  for (const c of chars) {
    if (/^\s/.test(c.ch) || c.ch === "") {
      if (cur.length) {
        tokens.push(cur);
        gaps.push((c.x0 + c.x1) / 2);
        cur = [];
      } else if (gaps.length) {
        gaps[gaps.length - 1] = (gaps[gaps.length - 1] + (c.x0 + c.x1) / 2) / 2; // a run of spaces: its middle
      }
    } else cur.push(c);
  }
  if (cur.length) tokens.push(cur);
  const adv = advance(tokens);
  const at = (p: Point, q: Point, t: number): Point => [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
  const out: Word[] = [];
  tokens.forEach((tok, n) => {
    const t = clean(tok.map((c) => c.ch).join(""));
    if (!t) return;
    const first = tok[0].x0, last = tok[tok.length - 1].x1;
    const x0 = n > 0 ? Math.min(first, Math.max(gaps[n - 1] + 0.2 * adv, first - 0.5 * adv)) : Math.max(0, first - adv);
    const x1 = n < gaps.length && n < tokens.length - 1
      ? Math.max(last, Math.min(gaps[n] - 0.2 * adv, last + 0.5 * adv))
      : Math.min(1, last + 0.5 * adv);
    const conf = tok.reduce((s, c) => s + c.p, 0) / tok.length;
    out.push({ text: t, confidence: round4(conf), box: [at(box[0], box[1], x0), at(box[0], box[1], x1), at(box[3], box[2], x1), at(box[3], box[2], x0)] });
  });
  return out.length ? out : whole;
}
