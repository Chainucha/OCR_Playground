import random

import pytest

pytest.importorskip("uharfbuzz")
pytest.importorskip("freetype")

import freetype  # noqa: E402

from ocr_playground.bench import find_samples  # noqa: E402
from ocr_playground.synth import KINDS, generate  # noqa: E402
from ocr_playground.synth import fake  # noqa: E402
from ocr_playground.synth.render import Font, default_fonts  # noqa: E402
from ocr_playground.synth.templates import TEMPLATES  # noqa: E402

needs_fonts = pytest.mark.skipif(not default_fonts(), reason="no Thai fonts here; set OCR_FONT_DIRS")


@pytest.mark.parametrize(("satang", "words"), [
    (120910, "หนึ่งพันสองร้อยเก้าบาทสิบสตางค์"),
    (2100, "ยี่สิบเอ็ดบาทถ้วน"),
    (1100, "สิบเอ็ดบาทถ้วน"),
    (100, "หนึ่งบาทถ้วน"),
    (10100, "หนึ่งร้อยเอ็ดบาทถ้วน"),
    (100000100, "หนึ่งล้านเอ็ดบาทถ้วน"),
    (250000000, "สองล้านห้าแสนบาทถ้วน"),
    (75, "เจ็ดสิบห้าสตางค์"),
    (0, "ศูนย์บาทถ้วน"),
])
def test_baht_text(satang, words):
    assert fake.baht_text(satang) == words


def test_fake_ids_never_pass_the_checksum():
    rng = random.Random(0)
    assert not any(fake.id13_is_valid(fake.invalid_id13(rng)) for _ in range(2000))
    assert fake.id13_is_valid("0000000000001")
    assert not fake.id13_is_valid("0000000000002")


def test_templates_are_deterministic_per_seed():
    for kind, template in TEMPLATES.items():
        first = template(random.Random(42)).ground_truth()
        assert first == template(random.Random(42)).ground_truth(), kind
        assert first.strip(), kind


@needs_fonts
def test_tone_marks_stack_above_upper_vowels():
    """Pillow's basic layout draws ่ on top of ิ in เพิ่ม; the image then disagrees with its ground truth."""
    em = 60
    for path in default_fonts():
        font = Font(path)
        for cluster in ["พิ่", "ปั้", "ทั้", "สิ้", "ฟื้", "ญี่", "นื่", "กี๊"]:
            font._ft.set_char_size(em * 64)
            extents = []
            for gid, _, _, dy in font.shape(cluster, em)[:-1]:
                font._ft.load_glyph(gid, freetype.FT_LOAD_DEFAULT)
                font._ft.glyph.render(freetype.FT_RENDER_MODE_NORMAL)
                top = font._ft.glyph.bitmap_top + dy
                extents.append((top - font._ft.glyph.bitmap.rows, top))
            (_, vowel_top), (tone_bottom, _) = extents[1], extents[2]
            assert tone_bottom >= vowel_top - em * 0.03, f"{path.name}: {cluster}"


@needs_fonts
def test_generated_pages_are_bench_samples(tmp_path):
    made = generate(tmp_path, len(KINDS), seed=1)
    samples = find_samples(tmp_path)

    assert sorted(s.image.name for s in samples) == sorted(f"synthetic-{k}-001.png" for k in KINDS)
    for page in made:
        gt = page.image.with_name(page.image.stem + ".gt.txt").read_text(encoding="utf-8")
        assert gt.strip()
        assert (page.image.parent / f"{page.image.stem}.meta.json").exists()

    again = generate(tmp_path, 1, kinds=["receipt"], seed=1)
    assert again[0].image.name == "synthetic-receipt-002.png"
