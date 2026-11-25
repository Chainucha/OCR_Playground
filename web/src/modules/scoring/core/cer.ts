// Character error rate, the same normalisation as engines/src/ocr_playground/scoring/metrics.py so browser and API scores agree.

const HTML_TAG = /<[^>]+>/g;
const MD_SYNTAX = /^\s{0,3}(#{1,6}\s|[-*+]\s|>\s?)|[*_`|]|^\s*:?-{3,}:?\s*$/gm;

/** Markup removed, NFC, sara am composed, and no whitespace: engines disagree on Thai word spaces. */
export function normalize(text: string): string {
  return text.replace(HTML_TAG, " ").replace(MD_SYNTAX, " ").normalize("NFC").replaceAll("ํา", "ำ").replace(/\s+/g, "");
}

function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function cer(reference: string, hypothesis: string): number {
  const ref = [...normalize(reference)], hyp = [...normalize(hypothesis)];
  if (!ref.length) return hyp.length ? 1 : 0;
  return levenshtein(ref, hyp) / ref.length;
}
