import importlib
import importlib.util
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ocr_playground.config import MODELS_DIR, env, require_import
from ocr_playground.engines import EngineUnavailable
from ocr_playground.result import Line, OcrResult, Stage

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
        import cv2

        start = time.perf_counter()
        # Decoded here, the way LineOCR._load does it, so opening the image is timed apart from the OCR.
        img = cv2.imread(str(image), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"cannot read image {image}")
        opened = time.perf_counter()
        out = self.ocr.read(img)
        end = time.perf_counter()
        latency_ms = (end - start) * 1000
        lines = [Line(text=l["text"], confidence=l.get("confidence"), box=l.get("box")) for l in out.get("lines", [])]
        return OcrResult(
            engine=self.name, text=out["text"], format="text", latency_ms=latency_ms, lines=lines,
            stages=_stages(latency_ms, (opened - start) * 1000, out.get("timing") or {}),
        )


def _stages(total_ms: float, open_ms: float, timing: dict) -> list[Stage]:
    """Splits a run along LineOCR.read's own clock: det_ms covers detection with the page rotation and deskew checks,
    rec_ms covers line splitting, recognition and reading order. What is left is building the output."""
    det, rec = timing.get("det_ms"), timing.get("rec_ms")
    if det is None or rec is None:
        return [Stage("Open image", open_ms), Stage("Find and read text", total_ms - open_ms)]
    return [
        Stage("Open image", open_ms),
        Stage("Find text lines", det),
        Stage("Read text", rec),
        Stage("Assemble text", max(0.0, total_ms - open_ms - det - rec)),
    ]
