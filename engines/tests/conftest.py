from dataclasses import dataclass
from pathlib import Path

import pytest

from ocr_playground import engines as registry
from ocr_playground.engines import EngineSpec, EngineUnavailable, OcrResult


@dataclass
class FakeEngine:
    name: str
    text: str

    def run(self, image: Path) -> OcrResult:
        return OcrResult(engine=self.name, text=self.text, format="text", latency_ms=1.0)


def _unavailable():
    raise EngineUnavailable("fake-missing: set FAKE_URL")


@pytest.fixture
def fake_registry(monkeypatch):
    specs = {
        "fake-good": EngineSpec("fake-good", "returns the right text", lambda: FakeEngine("fake-good", "สวัสดี ครับ")),
        "fake-bad": EngineSpec("fake-bad", "returns wrong text", lambda: FakeEngine("fake-bad", "สวัสดี")),
        "fake-missing": EngineSpec("fake-missing", "never loads", _unavailable),
    }
    monkeypatch.setattr(registry, "REGISTRY", specs)
    monkeypatch.setattr(registry, "_loaded", {})
    return specs
