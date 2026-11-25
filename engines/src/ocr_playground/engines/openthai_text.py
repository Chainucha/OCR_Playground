import importlib
import importlib.util
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ocr_playground.config import MODELS_DIR, env, require_import
from ocr_playground.engines import EngineUnavailable
from ocr_playground.result import Line, OcrResult

NAME = "openthai-text"
HF_REPO = "iapp/OpenThai2.1-OCR-Text-20261118"
DEFAULT_DIR = MODELS_DIR / NAME


def load_runtime(model_dir: Path) -> Any:
    package = "openthai_text_runtime"
    if package not in sys.modules:
        init = model_dir / "runtime" / "__init__.py"
        spec = importlib.util.spec_from_file_location(package, init, submodule_search_locations=[str(init.parent)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[package] = module
        spec.loader.exec_module(module)
    return importlib.import_module(f"{package}.line_engine")


@dataclass
class OpenThaiText:
    ocr: Any
    name: str = NAME

    @classmethod
    def from_env(cls) -> "OpenThaiText":
        for module in ("numpy", "cv2", "pyclipper", "onnxruntime"):
            require_import(module, NAME, "openthai-text")
        model_dir = Path(env("OPENTHAI_TEXT_DIR", str(DEFAULT_DIR)))
        if not (model_dir / "runtime" / "line_engine.py").exists():
            raise EngineUnavailable(f"{NAME}: no model at {model_dir}; run `uv run ocr download {NAME}`")
        threads = int(env("OPENTHAI_TEXT_THREADS", "1"))
        return cls(load_runtime(model_dir).LineOCR(str(model_dir), threads=threads))

    def run(self, image: Path) -> OcrResult:
        start = time.perf_counter()
        out = self.ocr.read(str(image))
        latency_ms = (time.perf_counter() - start) * 1000
        lines = [Line(text=l["text"], confidence=l.get("confidence"), box=l.get("box")) for l in out.get("lines", [])]
        return OcrResult(engine=self.name, text=out["text"], format="text", latency_ms=latency_ms, lines=lines)
