import pytest

from ocr_playground.config import SAMPLES_DIR
from ocr_playground.engines import EngineUnavailable
from ocr_playground.engines.openthai_text import OpenThaiText

SAMPLE = SAMPLES_DIR / "synthetic-invoice-001.png"


@pytest.fixture(scope="module")
def engine():
    try:
        return OpenThaiText.from_env()
    except EngineUnavailable as exc:
        pytest.skip(str(exc))


def test_stages_follow_line_ocr_and_add_up_to_the_latency(engine):
    result = engine.run(SAMPLE)
    assert [s.name for s in result.stages] == ["Open image", "Find text lines", "Read text", "Assemble text"]
    assert all(s.ms >= 0 for s in result.stages)
    # det_ms and rec_ms come rounded to 0.1 ms.
    assert sum(s.ms for s in result.stages) == pytest.approx(result.latency_ms, abs=0.2)


def test_decoding_the_image_ourselves_reads_the_same_as_passing_the_path(engine):
    assert engine.run(SAMPLE).text == engine.ocr.read(str(SAMPLE))["text"]
