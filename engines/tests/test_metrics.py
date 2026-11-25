import pytest

from ocr_playground.scoring import cer, normalize


def test_identical_text_scores_zero():
    assert cer("ใบกำกับภาษี", "ใบกำกับภาษี") == 0.0


def test_whitespace_differences_are_ignored():
    assert cer("ใบกำกับ ภาษี\nเลขที่ 001", "ใบกำกับภาษี เลขที่001") == 0.0


def test_markdown_and_html_markup_are_ignored():
    hypothesis = "# ใบเสร็จ\n\n<table><tr><td>รวม</td><td>100</td></tr></table>\n**ขอบคุณ**"
    assert cer("ใบเสร็จ รวม 100 ขอบคุณ", hypothesis) == 0.0


def test_decomposed_sara_am_matches_composed():
    assert normalize("นํา") == normalize("นำ")


def test_one_wrong_character_in_ten():
    assert cer("0123456789", "0123456780") == pytest.approx(0.1)


def test_empty_reference():
    assert cer("", "") == 0.0
    assert cer("", "x") == 1.0
