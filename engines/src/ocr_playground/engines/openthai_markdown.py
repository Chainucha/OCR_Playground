import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ocr_playground.config import env, require_env, require_import
from ocr_playground.engines import EngineUnavailable
from ocr_playground.result import Line, OcrResult

NAME = "openthai-markdown"
HF_REPO = "iapp/OpenThai2.1-OCR-Markdown-20261118"


def _quad(bbox: list[float] | None) -> list[list[float]] | None:
    if not bbox or len(bbox) != 4:
        return None
    x1, y1, x2, y2 = bbox
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


@dataclass
class OpenThaiMarkdown:
    parser: Any
    name: str = NAME

    @classmethod
    def from_env(cls) -> "OpenThaiMarkdown":
        require_import("openai", NAME, "openthai-markdown")
        try:
            from nemotron_parse.inference import DocumentParser
        except ImportError as exc:
            raise EngineUnavailable(
                f"{NAME}: the nemotron_parse client ships inside the model repo; see the openthai-markdown setup in README.md"
            ) from exc
        base_url = require_env("OPENTHAI_MD_BASE_URL", NAME)
        model = env("OPENTHAI_MD_MODEL", "nemotron-parse")
        api_key = env("OPENTHAI_MD_API_KEY", "EMPTY")
        return cls(DocumentParser(base_url=base_url, model=model, api_key=api_key))

    def run(self, image: Path) -> OcrResult:
        start = time.perf_counter()
        doc = self.parser.parse(str(image), mode="single")
        latency_ms = (time.perf_counter() - start) * 1000
        lines = [Line(text=b.get("text", ""), box=_quad(b.get("bbox"))) for b in doc.get("blocks", [])]
        return OcrResult(engine=self.name, text=doc["markdown"], format="markdown", latency_ms=latency_ms, lines=lines)
