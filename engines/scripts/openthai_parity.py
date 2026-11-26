"""Reference side of the parity check between OpenThai OCR-Text in Python and its browser port.

Reads every image in a folder with iApp's LineOCR.read, as the engine API does, and writes for each page:
  <name>.json  text, lines (box, row, words), dropped, rotation, text_angle and the time LineOCR.read took
  <name>.bgr   the decoded pixels (cv2.imread, height x width x 3, BGR), so the TypeScript side reads the same input

Usage, from engines/:
  python -m uv run python scripts/openthai_parity.py <image folder> <output folder>

Then run web/scripts/openthai-parity.ts on the output folder. Keep the output folder outside the repo when the
images are real documents.
"""

import json
import sys
import time
from pathlib import Path

import cv2

from ocr_playground.engines.openthai_text import DEFAULT_DIR, load_runtime

IMAGES = {".png", ".jpg", ".jpeg"}


def main(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    ocr = load_runtime(DEFAULT_DIR).LineOCR(str(DEFAULT_DIR))
    for path in sorted(p for p in src.iterdir() if p.suffix.lower() in IMAGES):
        img = cv2.imread(str(path), cv2.IMREAD_COLOR)
        (out / f"{path.stem}.bgr").write_bytes(img.tobytes())
        start = time.perf_counter()
        r = ocr.read(img)
        ms = (time.perf_counter() - start) * 1000
        row = {
            "width": img.shape[1], "height": img.shape[0], "ms": round(ms, 1),
            **{k: r[k] for k in ("text", "lines", "dropped", "rotation", "text_angle")},
        }
        (out / f"{path.stem}.json").write_text(json.dumps(row, ensure_ascii=False, default=float), encoding="utf-8")
        print(f"{path.stem:<40} {ms / 1000:6.1f} s  {len(r['lines'])} lines  rotation {r['rotation']}", flush=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
