"""The HTTP API the web app calls (GET /engines, POST /ocr). `ocr serve` runs `ocr_playground.api:app`."""

from ocr_playground.api.server import app

__all__ = ["app"]
