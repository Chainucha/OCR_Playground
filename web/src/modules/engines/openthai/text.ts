// Text clean-up and the line filter, ported from iApp's runtime/thai_norm.py and runtime/line_engine.py.

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

/** A recognised line as the page should read: canonical Thai, look-alike letters fixed, decimal commas made points. */
export function cleanLine(raw: string): string {
  return canonical(raw).replace(LONE_W, "พ").replace(ZERO_IN_THAI, "๐").replace(DECIMAL_COMMA, "$1.$2");
}

const DIGITS_OR_LATIN = /^[0-9๐-๙A-Za-z]+$/;
const MARKS = new Set("ัิีึืฺุู็่้๊๋์ํ๎");
const LEADING = new Set("เแโใไ");
const isThai = (ch: string) => ch >= "฀" && ch <= "๿";
const isCons = (ch: string | undefined) => !!ch && ch >= "ก" && ch <= "ฮ";

function invalidShare(text: string): number {
  const chars = [...text];
  let thai = 0;
  let bad = 0;
  chars.forEach((ch, i) => {
    if (!isThai(ch)) return;
    thai += 1;
    const prev = i ? chars[i - 1] : " ";
    if (MARKS.has(ch) && !(isCons(prev) || (MARKS.has(prev) && i >= 2 && isCons(chars[i - 2])))) bad += 1;
    else if (LEADING.has(ch) && !isCons(chars[i + 1])) bad += 1;
  });
  return thai ? bad / thai : 0;
}

// The model's config.json values for the line filter (drop_below 0.8, min_chars 2, the digit and Latin exception).
const FILTER = { dropBelow: 0.8, minChars: 2, minCharsDigits: 1, digitsHeight: 0.62, junkBelow: 0.9, junkInvalid: 0.05 };

/** Why the line filter drops a cleaned reading, or null. heightRatio is the box height over the page's line height. */
export function dropReason(text: string, conf: number, heightRatio: number): string | null {
  if (!text) return "empty";
  if (conf < FILTER.dropBelow) return "low_confidence";
  const bare = text.replaceAll(" ", "");
  const short = DIGITS_OR_LATIN.test(bare) && heightRatio >= FILTER.digitsHeight ? FILTER.minCharsDigits : FILTER.minChars;
  if ([...bare].length < short) return "too_short";
  if (conf < FILTER.junkBelow && invalidShare(text) > FILTER.junkInvalid) return "invalid_thai";
  return null;
}
