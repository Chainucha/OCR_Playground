"""Synthetic Thai documents with exact ground truth: `<name>.png`, `<name>.gt.txt`, `<name>.meta.json`."""

import json
import random
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from ocr_playground.synth.document import Document
from ocr_playground.synth.render import LayoutError, MissingGlyph, default_fonts, degrade, render
from ocr_playground.synth.templates import TEMPLATES

__all__ = ["KINDS", "Generated", "Quality", "generate"]

Quality = Literal["clean", "scan", "mixed"]
KINDS = list(TEMPLATES)


@dataclass
class Generated:
    image: Path
    kind: str
    font: str
    quality: str
    seed: int


def _next_index(out: Path, kind: str) -> int:
    pattern = re.compile(rf"^synthetic-{re.escape(kind)}-(\d+)\.gt\.txt$")
    taken = [int(m.group(1)) for p in out.glob(f"synthetic-{kind}-*.gt.txt") if (m := pattern.match(p.name))]
    return max(taken, default=0) + 1


def _render_with_any(doc: Document, fonts: list[Path], rng: random.Random):
    errors = []
    for font in rng.sample(fonts, len(fonts)):
        try:
            return render(doc, font), font
        except (MissingGlyph, LayoutError) as exc:
            errors.append(str(exc))
    raise LayoutError(f"No font could draw this {doc.kind} page: " + "; ".join(errors[:3]))


def generate(
    out: Path,
    count: int,
    kinds: list[str] | None = None,
    quality: Quality = "mixed",
    seed: int | None = None,
    fonts: list[Path] | None = None,
) -> list[Generated]:
    kinds = kinds or KINDS
    unknown = [k for k in kinds if k not in TEMPLATES]
    if unknown:
        raise ValueError(f"Unknown kind {', '.join(unknown)}. Known: {', '.join(KINDS)}")
    fonts = list(fonts or default_fonts())
    if not fonts:
        raise ValueError("No Thai-capable fonts found. Install some or point OCR_FONT_DIRS at a folder of .ttf files.")

    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    next_index = {kind: _next_index(out, kind) for kind in kinds}
    made = []
    for i in range(count):
        kind = kinds[i % len(kinds)]
        page_seed = rng.getrandbits(32)
        page_rng = random.Random(page_seed)
        doc = TEMPLATES[kind](page_rng)
        page_quality = page_rng.choice(["clean", "scan"]) if quality == "mixed" else quality
        image, font = _render_with_any(doc, fonts, page_rng)
        if page_quality == "scan":
            image = degrade(image, page_rng)

        name = f"synthetic-{kind}-{next_index[kind]:03d}"
        next_index[kind] += 1
        image.save(out / f"{name}.png")
        (out / f"{name}.gt.txt").write_text(doc.ground_truth(), encoding="utf-8")
        result = Generated(out / f"{name}.png", kind, font.name, page_quality, page_seed)
        meta = {"kind": kind, "font": font.name, "quality": page_quality, "seed": page_seed}
        (out / f"{name}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        made.append(result)
    return made
