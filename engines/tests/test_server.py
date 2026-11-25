import io
import threading
import time

import pytest

from fastapi.testclient import TestClient
from PIL import Image

from ocr_playground.api import app, server
from ocr_playground.engines import EngineSpec, OcrResult, Stage, get_engine
from conftest import FakeEngine


@pytest.fixture(autouse=True)
def _fresh_run_counts(monkeypatch):
    monkeypatch.setattr(server, "_runs", {})


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
        "runs": 0,
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


def test_engines_in_one_request_run_at_the_same_time(fake_registry, monkeypatch):
    # Each engine waits at the barrier for the other; run one after another, the first would time out.
    barrier = threading.Barrier(2, timeout=5)

    class Meets(FakeEngine):
        def run(self, image):
            barrier.wait()
            return super().run(image)

    for name in ("fake-good", "fake-bad"):
        text = "สวัสดี ครับ" if name == "fake-good" else "สวัสดี"
        fake_registry[name] = EngineSpec(name, "meets the other", lambda n=name, t=text: Meets(n, t))
    response = TestClient(app).post(
        "/ocr",
        files={"file": ("page.png", _png(), "image/png")},
        data={"engines": ["fake-good", "fake-bad"]},
    )
    assert [r["ok"] for r in response.json()] == [True, True]
    assert [r["engine"] for r in response.json()] == ["fake-good", "fake-bad"]


def test_concurrent_first_calls_load_an_engine_once(fake_registry):
    loads = []
    start = threading.Barrier(4, timeout=5)

    def slow_load():
        loads.append(1)
        time.sleep(0.05)
        return FakeEngine("fake-good", "x")

    fake_registry["fake-good"] = EngineSpec("fake-good", "slow to load", slow_load)

    def first_call():
        start.wait()
        get_engine("fake-good")

    threads = [threading.Thread(target=first_call) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(loads) == 1


def _post(engines: list[str], **data):
    return TestClient(app).post(
        "/ocr", files={"file": ("page.png", _png(), "image/png")}, data={"engines": engines, **data}
    )


def test_warm_up_runs_are_marked_cold_and_counted(fake_registry):
    cold = [_post(["fake-good"]).json()[0]["cold"] for _ in range(server.WARMUP_RUNS + 1)]
    assert cold == [True] * server.WARMUP_RUNS + [False]
    runs = {s["name"]: s["runs"] for s in TestClient(app).get("/engines").json()}
    assert runs == {"fake-good": server.WARMUP_RUNS + 1, "fake-bad": 0, "fake-missing": 0}


def test_parallel_false_runs_engines_one_after_another(fake_registry):
    events = []

    class Logs(FakeEngine):
        def run(self, image):
            events.append(f"start {self.name}")
            time.sleep(0.05)
            events.append(f"end {self.name}")
            return super().run(image)

    for name in ("fake-good", "fake-bad"):
        fake_registry[name] = EngineSpec(name, "logs its run", lambda n=name: Logs(n, "x"))
    response = _post(["fake-good", "fake-bad"], parallel="false")
    assert [r["ok"] for r in response.json()] == [True, True]
    assert events == ["start fake-good", "end fake-good", "start fake-bad", "end fake-bad"]


def test_stages_cover_the_server_side_of_a_run(fake_registry):
    plain, = _post(["fake-good"]).json()
    assert [st["name"] for st in plain["stages"]] == ["Receive page", "Wait to start", "Engine"]
    assert plain["stages"][-1]["ms"] == plain["latency_ms"]

    class Staged(FakeEngine):
        def run(self, image):
            return OcrResult(engine=self.name, text=self.text, format="text", latency_ms=3.0,
                             stages=[Stage("Find text lines", 1.0), Stage("Read text", 2.0)])

    fake_registry["fake-bad"] = EngineSpec("fake-bad", "says where its time went", lambda: Staged("fake-bad", "x"))
    scored, = _post(["fake-bad"], ground_truth="x").json()
    assert [st["name"] for st in scored["stages"]] == [
        "Receive page", "Wait to start", "Find text lines", "Read text", "Score accuracy",
    ]
