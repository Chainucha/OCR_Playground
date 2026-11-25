"""Run and compare OCR engines.

Modules, each a package whose `__init__` is its public API (pyproject `[tool.importlinter]` enforces this):

- `cli`, `api`: entry points (`ocr` command, FastAPI app).
- `bench`: score engines on a folder of samples.
- `engines`, `scoring`, `synth`: independent of each other.
- `config`: shared paths; imports nothing from the other modules.
"""
