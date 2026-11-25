"""Environment checks the engine adapters share: each failure raises EngineUnavailable with the fix."""

import os

from ocr_playground.engines import EngineUnavailable


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    return value or None


def require_env(name: str, engine: str) -> str:
    value = env(name)
    if value is None:
        raise EngineUnavailable(f"{engine}: set {name} (see .env.example)")
    return value


def require_import(module: str, engine: str, extra: str) -> None:
    try:
        __import__(module)
    except ImportError as exc:
        raise EngineUnavailable(f"{engine}: missing {exc.name}; run `uv sync --extra {extra}`") from exc
