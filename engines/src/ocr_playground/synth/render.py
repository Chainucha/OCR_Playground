"""Draw a Document with HarfBuzz shaping.

Pillow without libraqm places Thai marks one after another instead of stacking them, so a
tone mark over an upper vowel (เพิ่ม) vanishes and the image no longer matches its ground
truth. HarfBuzz positions the marks; FreeType rasterizes the shaped glyphs.
"""

import io
import os
import random
import sys
from functools import cache
from pathlib import Path

import freetype
import numpy as np
import uharfbuzz as hb
from PIL import Image, ImageFilter

from ocr_playground.synth.document import Cell, Document, Row

FONT_SUFFIXES = {".ttf", ".otf", ".ttc"}
REQUIRED_CHARS = "กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮะาำิีึืุูเแโใไๅ่้๊๋็์ัAZaz09.,:/-()%@"
CONSONANT_HEIGHT = 0.5
"""Height of ก as a fraction of Document.font_px, so fonts with small or large Thai glyphs print alike."""
LINE_HEIGHT = 1.6
BASELINE = 0.95


class MissingGlyph(ValueError):
    pass


class LayoutError(ValueError):
    pass


def system_font_dirs() -> list[Path]:
    home = Path.home()
    if sys.platform == "win32":
        return [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts",
                Path(os.environ.get("LOCALAPPDATA", home)) / "Microsoft" / "Windows" / "Fonts"]
    if sys.platform == "darwin":
        return [Path("/Library/Fonts"), Path("/System/Library/Fonts"), home / "Library" / "Fonts"]
    return [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), home / ".local" / "share" / "fonts", home / ".fonts"]


def font_dirs() -> list[Path]:
    configured = os.environ.get("OCR_FONT_DIRS")
    return [Path(p) for p in configured.split(os.pathsep) if p] if configured else system_font_dirs()


def covers_thai(path: Path) -> bool:
    try:
        face = freetype.Face(str(path), 0)
    except (freetype.FT_Exception, OSError):
        return False
    return all(face.get_char_index(ch) for ch in REQUIRED_CHARS)


def find_fonts(dirs: list[Path] | None = None) -> list[Path]:
    """Fonts that cover Thai, Latin and digits, from OCR_FONT_DIRS or the system font folders."""
    found = []
    for folder in dirs if dirs is not None else font_dirs():
        if folder.is_dir():
            found += [p for p in folder.rglob("*") if p.suffix.lower() in FONT_SUFFIXES and covers_thai(p)]
    return sorted(set(found))


class Font:
    def __init__(self, path: Path):
        self.path = path
        self._hb = hb.Font(hb.Face(hb.Blob.from_file_path(str(path)), 0))
        self._ft = freetype.Face(str(path), 0)
        self._ft.load_char("ก", freetype.FT_LOAD_NO_SCALE)
        self.consonant_ratio = self._ft.glyph.metrics.height / self._ft.units_per_EM

    def em_for(self, font_px: float) -> float:
        return font_px * CONSONANT_HEIGHT / self.consonant_ratio

    def shape(self, text: str, em: float) -> list[tuple[int, float, float, float]]:
        """Glyph id, pen x, x offset and y offset (pixels) for each glyph of `text`, then the end pen position."""
        if not text:
            return [(0, 0.0, 0.0, 0.0)]
        self._hb.scale = (round(em * 64),) * 2
        buf = hb.Buffer()
        buf.add_codepoints([ord(ch) for ch in text])
        buf.guess_segment_properties()
        hb.shape(self._hb, buf)
        glyphs, pen = [], 0.0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            if info.codepoint == 0 and not text[info.cluster].isspace():
                raise MissingGlyph(f"{self.path.name} has no glyph for {text[info.cluster]!r}")
            glyphs.append((info.codepoint, pen, pos.x_offset / 64, pos.y_offset / 64))
            pen += pos.x_advance / 64
        glyphs.append((0, pen, 0.0, 0.0))
        return glyphs

    def width(self, text: str, em: float) -> float:
        return self.shape(text, em)[-1][1]

    def draw(self, ink: np.ndarray, text: str, em: float, x: float, baseline: float, bold: bool = False) -> None:
        glyphs = self.shape(text, em)
        self._ft.set_char_size(round(em * 64))
        strokes = [0.0, max(1.0, em / 28)] if bold else [0.0]
        for gid, pen, dx, dy in glyphs[:-1]:
            self._ft.load_glyph(gid, freetype.FT_LOAD_DEFAULT)
            self._ft.glyph.render(freetype.FT_RENDER_MODE_NORMAL)
            bitmap = self._ft.glyph.bitmap
            if not (bitmap.width and bitmap.rows):
                continue
            alpha = np.array(bitmap.buffer, dtype=np.float32).reshape(bitmap.rows, bitmap.pitch)[:, :bitmap.width] / 255
            top = round(baseline - dy) - self._ft.glyph.bitmap_top
            for stroke in strokes:
                left = round(x + pen + dx + stroke) + self._ft.glyph.bitmap_left
                _stamp(ink, alpha, left, top)


def _stamp(ink: np.ndarray, alpha: np.ndarray, left: int, top: int) -> None:
    y0, x0 = max(top, 0), max(left, 0)
    y1, x1 = min(top + alpha.shape[0], ink.shape[0]), min(left + alpha.shape[1], ink.shape[1])
    if y1 > y0 and x1 > x0:
        region = ink[y0:y1, x0:x1]
        np.maximum(region, alpha[y0 - top:y1 - top, x0 - left:x1 - left], out=region)


def _spans(font: Font, cells: tuple[Cell, ...], em: float, content: float) -> list[tuple[float, float]]:
    spans = []
    for cell in cells:
        width = font.width(cell.text, em)
        anchor = cell.x * content
        left = {"left": anchor, "right": anchor - width, "center": anchor - width / 2}[cell.align]
        spans.append((left, left + width))
    return spans


def _fits(spans: list[tuple[float, float]], content: float, gap: float) -> bool:
    ordered = sorted(spans)
    if not ordered:
        return True
    inside = ordered[0][0] >= -0.5 and max(end for _, end in ordered) <= content + 0.5
    return inside and all(prev_end + gap <= start for (_, prev_end), (start, _) in zip(ordered, ordered[1:]))


def _layout_row(font: Font, r: Row, em: float, content: float) -> tuple[float, list[tuple[float, float]]]:
    """Shrink a row until its cells fit side by side inside the content width."""
    for _ in range(8):
        spans = _spans(font, r.cells, em, content)
        if _fits(spans, content, gap=em * 0.4):
            return em, spans
        em *= 0.92
    raise LayoutError(f"{font.path.name}: row does not fit: {' | '.join(c.text for c in r.cells)}")


def page_height(doc: Document) -> int:
    return doc.height or round(2 * doc.margin + sum(
        doc.font_px * r.size * LINE_HEIGHT * (1 + r.space_before) for r in doc.rows))


def render(doc: Document, font_path: Path) -> Image.Image:
    font = Font(font_path)
    width, height = doc.width, page_height(doc)
    content = width - 2 * doc.margin
    ink = np.zeros((height, width), dtype=np.float32)
    rule = max(2, doc.font_px // 14)

    y = float(doc.margin)
    for r in doc.rows:
        line = doc.font_px * r.size * LINE_HEIGHT
        y += line * r.space_before
        em, spans = _layout_row(font, r, font.em_for(doc.font_px * r.size), content)
        baseline = y + doc.font_px * r.size * BASELINE
        for cell, (left, _) in zip(r.cells, spans):
            font.draw(ink, cell.text, em, doc.margin + left, baseline, r.bold)
            if cell.underline:
                under = round(baseline + doc.font_px * r.size * 0.35)
                ink[under:under + rule, round(doc.margin + left) - 6:doc.margin + content] = 1
        if r.rule_below:
            bottom = round(y + line - rule)
            ink[bottom:bottom + rule, doc.margin:doc.margin + content] = 1
        y += line
    if y > height - doc.margin / 2:
        raise LayoutError(f"{font.path.name}: content runs off the page")

    for x0, y0, x1, y1 in doc.boxes:
        left, top, right, bottom = round(x0 * width), round(y0 * height), round(x1 * width), round(y1 * height)
        ink[top:bottom, left:left + rule] = ink[top:bottom, right - rule:right] = 1
        ink[top:top + rule, left:right] = ink[bottom - rule:bottom, left:right] = 1

    paper = np.array(doc.paper, dtype=np.float32)
    color = np.array((20, 20, 28), dtype=np.float32)
    pixels = paper * (1 - ink[..., None]) + color * ink[..., None]
    return Image.fromarray(pixels.round().astype(np.uint8), "RGB")


def degrade(image: Image.Image, rng: random.Random) -> Image.Image:
    """Make a clean page look scanned: skew, uneven paper, blur, resolution loss, noise, JPEG."""
    tint = np.array([rng.uniform(0.9, 1.0), rng.uniform(0.9, 1.0), rng.uniform(0.86, 0.97)], dtype=np.float32)
    background = tuple(int(255 * t) for t in tint)
    image = image.rotate(rng.uniform(-1.5, 1.5), resample=Image.Resampling.BICUBIC, fillcolor=background)

    pixels = np.asarray(image, dtype=np.float32) * tint
    shade = np.linspace(rng.uniform(0.9, 1.0), rng.uniform(0.9, 1.0), pixels.shape[1], dtype=np.float32)
    pixels *= shade[None, :, None]
    noise = np.random.default_rng(rng.getrandbits(32)).normal(0, rng.uniform(3, 10), pixels.shape[:2])
    pixels += noise[..., None].astype(np.float32)
    image = Image.fromarray(pixels.clip(0, 255).astype(np.uint8), "RGB")

    image = image.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.0)))
    scale = rng.uniform(0.6, 0.9)
    small = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.BILINEAR)
    image = small.resize(image.size, Image.Resampling.BILINEAR)

    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=rng.randint(45, 85))
    return Image.open(io.BytesIO(buffer.getvalue())).convert("RGB")


@cache
def default_fonts() -> tuple[Path, ...]:
    return tuple(find_fonts())
