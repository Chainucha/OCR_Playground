import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = Path(os.environ.get("OCR_MODELS_DIR", REPO_ROOT / "models"))
SAMPLES_DIR = REPO_ROOT / "data" / "samples"
