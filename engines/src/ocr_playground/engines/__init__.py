"""Engine registry. Adapters (openthai_text, openthai_markdown, typhoon) load lazily, on first use."""

import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ocr_playground.engines.result import Line, OcrResult, Stage

__all__ = [
    "Engine",
    "EngineSpec",
    "EngineUnavailable",
    "Line",
    "ModelDownload",
    "OcrResult",
    "Stage",
    "engine_names",
    "engine_status",
    "get_engine",
    "model_downloads",
]


class Engine(Protocol):
    name: str

    def run(self, image: Path) -> OcrResult: ...


class EngineUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class EngineSpec:
    name: str
    description: str
    load: Callable[[], Engine]


@dataclass(frozen=True)
class ModelDownload:
    """Where `ocr download` fetches an engine's model files: a Hugging Face repo, minus `ignore` patterns."""

    repo: str
    ignore: list[str] | None = None


def model_downloads() -> dict[str, ModelDownload]:
    # Importing an adapter module is cheap: models load in from_env(), not at import.
    from ocr_playground.engines import openthai_markdown, openthai_text

    return {
        openthai_text.NAME: ModelDownload(openthai_text.HF_REPO),
        openthai_markdown.NAME: ModelDownload(openthai_markdown.HF_REPO, openthai_markdown.DOWNLOAD_IGNORE),
    }


def _openthai_text() -> Engine:
    from ocr_playground.engines.openthai_text import OpenThaiText

    return OpenThaiText.from_env()


def _openthai_markdown() -> Engine:
    from ocr_playground.engines.openthai_markdown import OpenThaiMarkdown

    return OpenThaiMarkdown.from_env()


def _typhoon() -> Engine:
    from ocr_playground.engines.typhoon import Typhoon

    return Typhoon.from_env()


REGISTRY: dict[str, EngineSpec] = {
    spec.name: spec
    for spec in (
        EngineSpec("openthai-text", "iapp OpenThai OCR-Text: CPU ONNX pipeline, plain text with line boxes", _openthai_text),
        EngineSpec("openthai-markdown", "iapp OpenThai OCR-Markdown: Nemotron Parse on a local GPU or vLLM, Markdown with HTML tables", _openthai_markdown),
        EngineSpec("typhoon", "Typhoon OCR on vLLM, Markdown with HTML tables", _typhoon),
    )
}

_loaded: dict[str, Engine] = {}
# One lock per engine: concurrent requests wait for a model that is loading instead of loading it twice.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def engine_names() -> list[str]:
    return list(REGISTRY)


def get_engine(name: str) -> Engine:
    if name not in REGISTRY:
        raise KeyError(f"Unknown engine {name!r}. Known: {', '.join(REGISTRY)}")
    if name in _loaded:
        return _loaded[name]
    with _locks_guard:
        lock = _locks.setdefault(name, threading.Lock())
    with lock:
        if name not in _loaded:
            _loaded[name] = REGISTRY[name].load()
    return _loaded[name]


def engine_status() -> list[dict]:
    status = []
    for spec in REGISTRY.values():
        try:
            get_engine(spec.name)
            status.append({"name": spec.name, "description": spec.description, "available": True, "reason": None})
        except EngineUnavailable as exc:
            status.append({"name": spec.name, "description": spec.description, "available": False, "reason": str(exc)})
    return status
