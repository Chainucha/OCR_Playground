// Word-level diff between the correct text and a model's output, for showing mistakes.
// Thai has no spaces between words, so words come from Intl.Segmenter's Thai dictionary, never from splitting on spaces.
// Comparing whole words also keeps a wrong tone mark inside its word instead of highlighting a mark on its own.

export type Segment = { kind: "same" | "missing" | "extra"; text: string };

export type Diff = {
  segments: Segment[];
  /** Runs of wrong words: one misread word that comes out as two words is still one mistake. */
  mistakes: number;
};

/** Above this many word pairs the table gets slow, so long pages show plain text instead of a diff. */
const MAX_CELLS = 4_000_000;

const BLOCK_END = /<\/(?:tr|p|h[1-6]|li|div|table)>|<br\s*\/?>/gi;
const HTML_TAG = /<[^>]+>/g;
const TABLE_RULE = /^[\s|:-]*-{3,}[\s|:-]*$/gm;
const MD_SYNTAX = /^\s{0,3}(?:#{1,6}\s|[-*+]\s|>\s?)|[*_`|]/gm;

/** Markdown and HTML reduced to the words a person reads, keeping line breaks. Same idea as normalize() in cer.ts. */
export function toPlainText(text: string): string {
  return text
    .replace(BLOCK_END, "\n")
    .replace(HTML_TAG, " ")
    .replace(TABLE_RULE, "")
    .replace(MD_SYNTAX, " ")
    .normalize("NFC")
    .replaceAll("ํา", "ำ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One line of a model's text as shown. `heading` marks a line the model wrote as a Markdown or HTML heading. */
export type Line = { heading: boolean; segments: Segment[] };

const MD_HEADING = /^\s{0,3}#{1,6}\s+(.+)$/gm;
const HTML_HEADING = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

/** A model's text in lines, with its headings marked. Pass the diff's segments to keep the mistake marks. */
export function toLines(text: string, segments: Segment[] = [{ kind: "same", text: toPlainText(text) }]): Line[] {
  const headings = new Set(
    [...text.matchAll(MD_HEADING), ...text.matchAll(HTML_HEADING)].map((m) => toPlainText(m[1])).filter(Boolean),
  );
  const lines: Segment[][] = [[]];
  for (const s of segments) {
    s.text.split("\n").forEach((part, k) => {
      if (k > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ kind: s.kind, text: part });
    });
  }
  return lines.map((line) => {
    const written = line.flatMap((s) => (s.kind === "missing" ? [] : [s.text])).join("").trim();
    return { heading: headings.has(written), segments: line };
  });
}

type Token = { word: string; after: string };

const segmenter = new Intl.Segmenter("th", { granularity: "word" });

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let lead = "";
  for (const { segment } of segmenter.segment(text)) {
    if (/^\s+$/.test(segment)) {
      if (tokens.length) tokens[tokens.length - 1].after += segment;
      else lead += segment;
    } else {
      tokens.push({ word: segment, after: "" });
    }
  }
  if (lead && tokens.length) tokens[0].word = lead + tokens[0].word;
  return tokens;
}

export function diffWords(reference: string, hypothesis: string): Diff | null {
  const ref = tokenize(toPlainText(reference));
  const hyp = tokenize(toPlainText(hypothesis));
  if ((ref.length + 1) * (hyp.length + 1) > MAX_CELLS) return null;

  // lcs[i][j] = longest common run of words in ref[i..] and hyp[j..]
  const lcs = Array.from({ length: ref.length + 1 }, () => new Uint32Array(hyp.length + 1));
  for (let i = ref.length - 1; i >= 0; i--) {
    for (let j = hyp.length - 1; j >= 0; j--) {
      lcs[i][j] = ref[i].word === hyp[j].word ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const segments: Segment[] = [];
  const push = (kind: Segment["kind"], text: string) => {
    const last = segments[segments.length - 1];
    if (last?.kind === kind) last.text += text;
    else segments.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < ref.length || j < hyp.length) {
    // Spacing always comes from the model's text and is never highlighted, so a mark covers only the wrong words.
    if (i < ref.length && j < hyp.length && ref[i].word === hyp[j].word) {
      push("same", hyp[j].word + hyp[j].after);
      i++;
      j++;
    } else if (i < ref.length && (j === hyp.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      // what the page says comes first, then what the model wrote instead
      push("missing", ref[i].word);
      i++;
    } else {
      push("extra", hyp[j].word);
      if (hyp[j].after) push("same", hyp[j].after);
      j++;
    }
  }

  let mistakes = 0;
  segments.forEach((s, k) => {
    if (s.kind !== "same" && (k === 0 || segments[k - 1].kind === "same")) mistakes++;
  });
  return { segments, mistakes };
}
