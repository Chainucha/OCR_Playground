"""DB post-processing on synthetic probability maps, step by step, for the browser port's detection tests.

Each case is a float32 map of rotated, line-shaped blobs (some with holes) and what iApp's line_engine makes of it:
the contours cv2.findContours returns, each contour's cv2.minAreaRect and box, its _box_score, the pyclipper outline
_unclip returns, and the final box. Writes web/src/modules/engines/openthai/det.fixtures.json, which
contours.test.ts and detect.test.ts read.

Usage, from engines/:  python -m uv run python scripts/det_fixtures.py
"""

import base64
import json
from pathlib import Path

import cv2
import numpy as np

from ocr_playground.engines.openthai_text import DEFAULT_DIR, load_runtime

le = load_runtime(DEFAULT_DIR)
OUT = Path(__file__).resolve().parents[2] / "web/src/modules/engines/openthai/det.fixtures.json"
rng = np.random.default_rng(11)
THRESH, BOX_THRESH, UNCLIP = 0.2, 0.4, 1.4


def prob_map(h: int, w: int) -> np.ndarray:
    m = np.zeros((h, w), np.float32)
    for _ in range(rng.integers(4, 9)):
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        lw, lh, ang = rng.uniform(4, w * 0.6), rng.uniform(2, 9), rng.uniform(-25, 25)
        blob = np.zeros_like(m)
        box = cv2.boxPoints(((cx, cy), (lw, lh), ang)).astype(np.int32)
        cv2.fillPoly(blob, [box], 1.0)
        if rng.random() < 0.3 and lh > 5:  # a ring: a hole inside
            cv2.fillPoly(blob, [cv2.boxPoints(((cx, cy), (lw * 0.4, lh * 0.3), ang)).astype(np.int32)], 0.0)
        m = np.maximum(m, blob * rng.uniform(0.5, 1.0))
    m = cv2.GaussianBlur(m, (5, 5), 1.2)
    return np.clip(m + rng.normal(0, 0.03, m.shape).astype(np.float32), 0, 1).astype(np.float32)


def f(a) -> list:
    return np.asarray(a, np.float64).tolist()


cases = []
for h, w in [(48, 80), (64, 96), (40, 120), (72, 72), (56, 160), (32, 64)]:
    prob = prob_map(h, w)
    bitmap = (prob > THRESH).astype(np.uint8)
    contours, _ = cv2.findContours(bitmap, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    steps = []
    for cnt in contours:
        rect = cv2.minAreaRect(cnt)
        box, side = le._mini_box(cnt)
        step = {"contour": cnt.reshape(-1, 2).tolist(), "rect": f([*rect[0], *rect[1], rect[2]]), "box": f(box),
                "score": le._box_score(prob, box)}
        big = le._unclip(box, UNCLIP)
        if big is not None:
            step["unclip"] = big.astype(int).tolist()
            big_box, big_side = le._mini_box(big.reshape(-1, 1, 2))
            step["big_rect"] = f([*cv2.minAreaRect(big.reshape(-1, 1, 2))[0], *cv2.minAreaRect(big.reshape(-1, 1, 2))[1],
                                  cv2.minAreaRect(big.reshape(-1, 1, 2))[2]])
            step["big_box"] = f(big_box)
        steps.append(step)
    cases.append({"w": w, "h": h, "prob": base64.b64encode(prob.tobytes()).decode(), "steps": steps})

OUT.write_text(json.dumps(cases), encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB), {sum(len(c['steps']) for c in cases)} contours")
