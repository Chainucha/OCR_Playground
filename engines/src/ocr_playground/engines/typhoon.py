import time
from dataclasses import dataclass
from pathlib import Path

from ocr_playground.engines._env import env, require_env, require_import
from ocr_playground.engines.result import OcrResult

NAME = "typhoon"


@dataclass
class Typhoon:
    base_url: str
    model: str
    api_key: str
    task_type: str
    name: str = NAME

    @classmethod
    def from_env(cls) -> "Typhoon":
        require_import("typhoon_ocr", NAME, "typhoon")
        return cls(
            base_url=require_env("TYPHOON_BASE_URL", NAME),
            model=env("TYPHOON_MODEL", "typhoon-ocr"),
            api_key=env("TYPHOON_API_KEY", "EMPTY"),
            task_type=env("TYPHOON_TASK_TYPE", "v1.5"),
        )

    def run(self, image: Path) -> OcrResult:
        from typhoon_ocr import ocr_document

        start = time.perf_counter()
        text = ocr_document(
            str(image), task_type=self.task_type, base_url=self.base_url, api_key=self.api_key, model=self.model
        )
        latency_ms = (time.perf_counter() - start) * 1000
        return OcrResult(engine=self.name, text=text, format="markdown", latency_ms=latency_ms)
