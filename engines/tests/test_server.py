import io

from fastapi.testclient import TestClient
from PIL import Image

from ocr_playground.server import app


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, "PNG")
    return buf.getvalue()


def test_engines_reports_availability(fake_registry):
    status = {s["name"]: s for s in TestClient(app).get("/engines").json()}
    assert status["fake-good"]["available"] is True
    assert status["fake-missing"] == {
        "name": "fake-missing",
        "description": "never loads",
        "available": False,
        "reason": "fake-missing: set FAKE_URL",
    }


def test_ocr_runs_every_requested_engine(fake_registry):
    response = TestClient(app).post(
        "/ocr",
        files={"file": ("page.png", _png(), "image/png")},
        data={"engines": ["fake-good", "fake-missing"]},
    )
    assert response.status_code == 200
    good, missing = response.json()
    assert good["ok"] is True and good["text"] == "สวัสดี ครับ"
    assert missing == {"ok": False, "engine": "fake-missing", "error": "fake-missing: set FAKE_URL"}


def test_ground_truth_adds_cer(fake_registry):
    response = TestClient(app).post(
        "/ocr",
        files={"file": ("page.png", _png(), "image/png")},
        data={"engines": ["fake-good", "fake-bad"], "ground_truth": "สวัสดีครับ"},
    )
    good, bad = response.json()
    assert good["cer"] == 0.0
    assert bad["cer"] == 0.4


def test_unknown_engine_is_rejected(fake_registry):
    response = TestClient(app).post(
        "/ocr", files={"file": ("page.png", _png(), "image/png")}, data={"engines": ["nope"]}
    )
    assert response.status_code == 400
