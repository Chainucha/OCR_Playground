import re
import unicodedata

from rapidfuzz.distance import Levenshtein

_HTML_TAG = re.compile(r"<[^>]+>")
_MD_SYNTAX = re.compile(r"^\s{0,3}(#{1,6}\s|[-*+]\s|>\s?)|[*_`|]|^\s*:?-{3,}:?\s*$", re.MULTILINE)
_WHITESPACE = re.compile(r"\s+")
_SARA_AM = ("ํา", "ำ")


def normalize(text: str) -> str:
    """Reduce OCR output to comparable characters: no markup, NFC, no whitespace.

    Whitespace is dropped because Thai has no word spaces and engines disagree on
    where to put them, so counting spaces would punish layout, not reading.
    """
    text = _HTML_TAG.sub(" ", text)
    text = _MD_SYNTAX.sub(" ", text)
    text = unicodedata.normalize("NFC", text).replace(*_SARA_AM)
    return _WHITESPACE.sub("", text)


def cer(reference: str, hypothesis: str) -> float:
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    return Levenshtein.distance(ref, hyp) / len(ref)
