// Text clean-up, the line filter and row joining, ported from iApp's runtime/thai_norm.py and runtime/line_engine.py.

import { CFG } from "./config";

const PUA: Record<number, number> = {
  0xf700: 0x0e10, 0xf701: 0x0e34, 0xf702: 0x0e35, 0xf703: 0x0e36, 0xf704: 0x0e37,
  0xf705: 0x0e48, 0xf706: 0x0e49, 0xf707: 0x0e4a, 0xf708: 0x0e4b, 0xf709: 0x0e4c,
  0xf70a: 0x0e48, 0xf70b: 0x0e49, 0xf70c: 0x0e4a, 0xf70d: 0x0e4b, 0xf70e: 0x0e4c,
  0xf70f: 0x0e0d, 0xf710: 0x0e31, 0xf711: 0x0e4d, 0xf712: 0x0e47, 0xf713: 0x0e48,
  0xf714: 0x0e49, 0xf715: 0x0e4a, 0xf716: 0x0e4b, 0xf717: 0x0e4c, 0xf718: 0x0e38,
  0xf719: 0x0e39, 0xf71a: 0x0e3a,
};
const DROP = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0x00ad, 0xfeff]);
const VOWEL_MARKS = "ัิีึืฺุู็";
const TONE_MARKS = "่้๊๋์๎";
const NIKHAHIT = "ํ";
const MARK_RUN = new RegExp(`[${VOWEL_MARKS}${TONE_MARKS}${NIKHAHIT}]{2,}`, "g");
const SARA_AM = /([่-๋]?)ํ([่-๋]?)า/g;

function markRank(ch: string): number {
  return VOWEL_MARKS.includes(ch) ? 0 : TONE_MARKS.includes(ch) ? 1 : 2;
}

/** thai_norm.canonical: one spelling for Thai text that renders the same. */
export function canonical(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (DROP.has(cp)) continue;
    out += cp === 0xa0 ? " " : PUA[cp] ? String.fromCodePoint(PUA[cp]) : ch;
  }
  out = out.normalize("NFC");
  out = out.replace(MARK_RUN, (run) =>
    [...run].sort((a, b) => markRank(a) - markRank(b)).filter((ch, i, all) => i === 0 || all[i - 1] !== ch).join(""),
  );
  out = out.replace(SARA_AM, (_, a: string, b: string) => `${a}${b}ำ`);
  out = out.replaceAll("เเ", "แ").replaceAll("ำำ", "ำ");
  out = out.replace(/\r\n?/g, "\n");
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .trim();
}

const LONE_W = /(?<![A-Za-z])[Ww](?=\.?[ก-ฮเ-ไ])/g;
const ZERO_IN_THAI = /(?<=[๐-๙])[Oo0]|[Oo0](?=[๐-๙])/g;
const DECIMAL_COMMA = /(?<![\p{Nd}.,])(\p{Nd}{1,3}(?:,\p{Nd}{3})*),(\p{Nd}{2})(?![\p{Nd}.,])/gu;

/** fix_scripts(canonical(raw)): a lone Latin W glued to Thai is พ, a Latin O or 0 among Thai digits is ๐. */
export function clean(raw: string): string {
  return canonical(raw).replace(LONE_W, "พ").replace(ZERO_IN_THAI, "๐");
}

/** A recognised line as the page shows it: clean(), then decimal commas made points when join.decimal_comma is on. */
export function lineText(raw: string): string {
  const text = clean(raw);
  return CFG.join.decimalComma ? text.replace(DECIMAL_COMMA, "$1.$2") : text;
}

/** Latin letters inside words that also hold Thai letters: a loopless Thai face read as Latin look-alikes (_mixed). */
export function mixed(text: string): number {
  let n = 0;
  for (const tok of text.split(/\s+/)) {
    if (/[ก-๎]/.test(tok)) n += (tok.match(/[A-Za-z]/g) ?? []).length;
  }
  return n;
}

/** The digits of a reading, in order (_digits). */
export const digits = (text: string) => (text.match(/\p{Nd}/gu) ?? []).join("");

/** A reading without its above and below marks (sara am as its aa) or spaces (_base). */
export const base = (text: string) => text.replaceAll("ำ", "า").replace(/[ัิ-ฺ็-๎\s]/g, "");

export const isThai = (ch: string) => ch >= "฀" && ch <= "๿";

const MARKS = new Set("ัิีึืฺุู็่้๊๋์ํ๎");
const LEADING = new Set("เแโใไ");
const isCons = (ch: string | undefined) => !!ch && ch >= "ก" && ch <= "ฮ";

/** Share of Thai characters that break Thai spelling: a mark with no consonant under it, or a stray leading vowel. */
export function invalidShare(text: string): number {
  const chars = [...text];
  let thai = 0, bad = 0;
  chars.forEach((ch, i) => {
    if (!isThai(ch)) return;
    thai += 1;
    const prev = i ? chars[i - 1] : " ";
    if (MARKS.has(ch) && !(isCons(prev) || (MARKS.has(prev) && i >= 2 && isCons(chars[i - 2])))) bad += 1;
    else if (LEADING.has(ch) && !isCons(chars[i + 1])) bad += 1;
  });
  return thai ? bad / thai : 0;
}

const SHORT_OK = CFG.rec.minCharsLatin ? /^[0-9๐-๙A-Za-z]+$/ : /^[0-9๐-๙]+$/;

/**
 * Why the line filter drops a cleaned reading, or null (_drop_reason). `heightRatio` is the box height over the
 * page's line height; without it the digit and Latin exception for short lines needs no height when its height
 * condition is off, and does not apply when it is on.
 */
export function dropReason(text: string, conf: number, heightRatio?: number): string | null {
  const rc = CFG.rec;
  if (!text) return "empty";
  if (conf < rc.dropBelow) return "low_confidence";
  const bare = text.replaceAll(" ", "");
  let short = rc.minChars;
  if (rc.minCharsDigits !== null && SHORT_OK.test(bare)
      && (rc.minCharsDigitsHeight <= 0 || (heightRatio !== undefined && heightRatio >= rc.minCharsDigitsHeight))) {
    short = rc.minCharsDigits;
  }
  if ([...bare].length < short) return "too_short";
  if (conf < rc.junkBelow && invalidShare(text) > rc.junkInvalid) return "invalid_thai";
  return null;
}

/**
 * The page's text from its rows (_join). `geom` is each row's top and bottom, `hline` the line height: with
 * join.paragraphs on, a blank line goes between rows far apart, or where reading moves back up the page.
 */
export function joinRows(rows: string[], geom: ([number, number] | null)[], hline: number): string {
  const jc = CFG.join;
  if (jc.paragraphs && geom.length === rows.length && !jc.thaiNoSpace) {
    const out: string[] = [];
    let prev: [number, number] | null = null;
    rows.forEach((r, i) => {
      const g = geom[i];
      if (out.length && prev && g && (g[0] - prev[1] > jc.paragraphGap * hline || g[1] < prev[0])) out.push("");
      out.push(r);
      prev = g ?? prev;
    });
    return out.join("\n");
  }
  if (!jc.thaiNoSpace) return rows.join("\n");
  // A Thai line wrap has no space at the break, so Thai-to-Thai joins get nothing.
  let out = rows[0] ?? "";
  for (const r of rows.slice(1)) out += (out && isThai(out[out.length - 1]) && isThai(r[0]) ? "" : "\n") + r;
  return out;
}
