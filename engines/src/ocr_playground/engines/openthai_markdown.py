import importlib
import importlib.util
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

from ocr_playground.config import MODELS_DIR
from ocr_playground.engines import EngineUnavailable
from ocr_playground.engines._env import env, require_import
from ocr_playground.engines.result import Line, OcrResult

NAME = "openthai-markdown"
HF_REPO = "iapp/OpenThai2.1-OCR-Markdown-20261118"
DEFAULT_DIR = MODELS_DIR / NAME
# What the engine doesn't use: the speculative-decoding draft (vLLM only), benchmark data, and README images.
DOWNLOAD_IGNORE = ["dflash2/*", "reference/*", "assets/*"]


def load_client(model_dir: Path) -> ModuleType:
    """iapp's nemotron_parse package, which ships in the model folder, not on PyPI."""
    package = "nemotron_parse"
    if package not in sys.modules:
        init = model_dir / package / "__init__.py"
        spec = importlib.util.spec_from_file_location(package, init, submodule_search_locations=[str(init.parent)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[package] = module
        spec.loader.exec_module(module)
    return importlib.import_module(f"{package}.inference")


class LocalBackend:
    """Runs the model on this machine with Transformers. Weights load on the first page, so listing engines stays fast."""

    def __init__(self, model_dir: Path, device: str, transformers_backend: type):
        self.model_dir, self.device, self.transformers_backend = model_dir, device, transformers_backend
        self._backend = None
        self._lock = threading.Lock()

    def _load(self) -> Any:
        import torch
        from transformers import AutoModel, AutoProcessor, GenerationConfig

        dtype = torch.bfloat16 if self.device.startswith("cuda") else torch.float32
        model = AutoModel.from_pretrained(self.model_dir, trust_remote_code=True, dtype=dtype).to(self.device).eval()
        processor = AutoProcessor.from_pretrained(self.model_dir, trust_remote_code=True)
        config = GenerationConfig.from_pretrained(self.model_dir, trust_remote_code=True)
        return self.transformers_backend(model, processor, config)

    def __call__(self, image, **kwargs) -> dict:
        with self._lock:
            if self._backend is None:
                self._backend = self._load()
        return self._backend(image, **kwargs)


def _local_device() -> str:
    for module in ("torch", "transformers", "timm", "einops"):
        require_import(module, NAME, "openthai-markdown-local")
    import torch

    device = env("OPENTHAI_MD_DEVICE") or ("cuda" if torch.cuda.is_available() else None)
    if device is None:
        raise EngineUnavailable(
            f"{NAME}: no CUDA GPU for local inference; set OPENTHAI_MD_BASE_URL to a vLLM server, "
            "or OPENTHAI_MD_DEVICE=cpu (minutes per page)"
        )
    return device


@dataclass
class OpenThaiMarkdown:
    parser: Any
    name: str = NAME

    @classmethod
    def from_env(cls) -> "OpenThaiMarkdown":
        model_dir = Path(env("OPENTHAI_MD_DIR", str(DEFAULT_DIR)))
        if not (model_dir / "nemotron_parse" / "inference.py").exists():
            raise EngineUnavailable(f"{NAME}: no model at {model_dir}; run `uv run ocr download {NAME}`")
        require_import("bs4", NAME, "openthai-markdown")
        base_url = env("OPENTHAI_MD_BASE_URL")
        if base_url:
            require_import("httpx", NAME, "openthai-markdown")
            inference = load_client(model_dir)
            parser = inference.DocumentParser(
                base_url=base_url,
                model=env("OPENTHAI_MD_MODEL", "nemotron-parse"),
                api_key=env("OPENTHAI_MD_API_KEY", "EMPTY"),
            )
            return cls(parser)
        if not (model_dir / "model.safetensors").exists():
            raise EngineUnavailable(f"{NAME}: no weights in {model_dir}; run `uv run ocr download {NAME}`")
        device = _local_device()
        inference = load_client(model_dir)
        return cls(inference.DocumentParser(backend=LocalBackend(model_dir, device, inference.TransformersBackend)))

    def run(self, image: Path) -> OcrResult:
        start = time.perf_counter()
        doc = self.parser.parse(str(image), mode="single")
        latency_ms = (time.perf_counter() - start) * 1000
        lines = [Line(text=b.get("text", ""), box=_quad(b.get("bbox"))) for b in doc.get("blocks", [])]
        return OcrResult(engine=self.name, text=doc["markdown"], format="markdown", latency_ms=latency_ms, lines=lines)


def _quad(bbox: list[float] | None) -> list[list[float]] | None:
    if not bbox or len(bbox) != 4:
        return None
    x1, y1, x2, y2 = bbox
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
