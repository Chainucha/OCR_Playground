"""OpenCV outputs on small random images, for the bit-exactness tests of the browser port's image steps.

Writes web/src/modules/engines/openthai/cv.fixtures.json: each case holds its inputs and what OpenCV returns, with
pixels base64-encoded. web/src/modules/engines/openthai/image.test.ts checks image.ts against it.

Usage, from engines/:  python -m uv run python scripts/cv_fixtures.py
"""

import base64
import json
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[2] / "web/src/modules/engines/openthai/cv.fixtures.json"
rng = np.random.default_rng(7)


def img(h: int, w: int, c: int) -> np.ndarray:
    # Smooth blobs plus noise: the full 0-255 range, with edges like text.
    base = cv2.resize(rng.integers(0, 256, (max(2, h // 4), max(2, w // 4), c), np.uint8), (w, h),
                      interpolation=cv2.INTER_CUBIC)
    base = base.reshape(h, w, c)
    noise = rng.integers(-40, 41, base.shape)
    return np.clip(base.astype(int) + noise, 0, 255).astype(np.uint8)


def enc(a: np.ndarray) -> dict:
    a = a if a.ndim == 3 else a[:, :, None]
    return {"h": a.shape[0], "w": a.shape[1], "c": a.shape[2], "data": base64.b64encode(a.tobytes()).decode()}


cases: dict[str, list] = {"resize": [], "warp": [], "affine": [], "gray": []}
for h, w, c, nh, nw in [(37, 53, 3, 21, 30), (40, 60, 3, 20, 30), (32, 100, 1, 16, 50), (20, 70, 1, 48, 168),
                        (48, 17, 3, 48, 17), (31, 47, 3, 64, 96), (51, 103, 3, 32, 48), (13, 9, 1, 26, 18),
                        (20, 450, 1, 16, 360), (12, 900, 1, 16, 1235)]:
    src = img(h, w, c)
    cases["resize"].append({"src": enc(src), "w": nw, "h": nh, "out": enc(cv2.resize(src, (nw, nh)))})

for _ in range(6):
    src = img(40, 64, 3)
    x0, y0 = rng.uniform(-5, 25), rng.uniform(-5, 15)
    w, h = rng.uniform(15, 45), rng.uniform(6, 22)
    t = rng.uniform(-0.3, 0.3)
    q = np.array([[0, 0], [w, 0], [w, h], [0, h]], np.float64)
    rot = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
    quad = (q @ rot.T + [x0, y0] + rng.uniform(-2, 2, (4, 2))).astype(np.float32)
    ow = int(max(np.linalg.norm(quad[0] - quad[1]), np.linalg.norm(quad[2] - quad[3])))
    oh = int(max(np.linalg.norm(quad[0] - quad[3]), np.linalg.norm(quad[1] - quad[2])))
    m = cv2.getPerspectiveTransform(quad, np.array([[0, 0], [ow, 0], [ow, oh], [0, oh]], np.float32))
    out = cv2.warpPerspective(src, m, (ow, oh), borderMode=cv2.BORDER_REPLICATE, flags=cv2.INTER_CUBIC)
    cases["warp"].append({"src": enc(src), "quad": quad.tolist(), "w": ow, "h": oh, "out": enc(out)})

for angle in (3.7, -5.2, 11.0):
    src = img(36, 48, 3)
    H, W = src.shape[:2]
    m = cv2.getRotationMatrix2D((W / 2, H / 2), angle, 1.0)
    c, s = abs(m[0, 0]), abs(m[0, 1])
    nW, nH = int(round(H * s + W * c)), int(round(H * c + W * s))
    m[0, 2] += nW / 2 - W / 2
    m[1, 2] += nH / 2 - H / 2
    fill = (200, 210, 220)
    out = cv2.warpAffine(src, m, (nW, nH), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=fill)
    cases["affine"].append({"src": enc(src), "m": m.tolist(), "fill": fill, "w": nW, "h": nH, "out": enc(out)})

src = img(30, 40, 3)
cases["gray"].append({"src": enc(src), "out": enc(cv2.cvtColor(src, cv2.COLOR_BGR2GRAY))})

OUT.write_text(json.dumps(cases), encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB), OpenCV {cv2.__version__}")
