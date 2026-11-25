import asyncio
import os
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from ocr_playground.engines import EngineUnavailable, engine_names, engine_status, get_engine
from ocr_playground.metrics import cer

app = FastAPI(title="OCR Playground engines")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("OCR_CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# An engine's first runs include warm-up (lazy weight loading, memory set-up, first-inference work). On 2026-11-25
# openthai-text read about 25% slow on runs 1 and 2 and steady from run 3, so the first WARMUP_RUNS are marked cold.
WARMUP_RUNS = 2
# Completed runs per engine since this process started.
_runs: dict[str, int] = {}


@app.get("/engines")
def list_engines() -> list[dict]:
    """Each engine's status, and `runs`: how many pages it has finished, so a client knows how much warm-up is left."""
    return [{**s, "runs": _runs.get(s["name"], 0)} for s in engine_status()]


@app.post("/ocr")
async def ocr(
    file: Annotated[UploadFile, File()],
    engines: Annotated[list[str], Form()],
    ground_truth: Annotated[str | None, Form()] = None,
    parallel: Annotated[bool, Form()] = True,
) -> list[dict]:
    unknown = [e for e in engines if e not in engine_names()]
    if unknown:
        raise HTTPException(400, f"Unknown engines: {', '.join(unknown)}")
    suffix = Path(file.filename or "upload.png").suffix or ".png"
    with tempfile.TemporaryDirectory() as tmp:
        image = Path(tmp) / f"page{suffix}"
        image.write_bytes(await file.read())
        # Each engine times only its own run. In parallel the response waits for the slowest engine, but engines that
        # share hardware slow each other down; one after another, each engine's time is what it takes alone.
        if parallel:
            return list(await asyncio.gather(*(_run_one(name, image, ground_truth) for name in engines)))
        return [await _run_one(name, image, ground_truth) for name in engines]


def _load_and_run(name: str, image: Path):
    return get_engine(name).run(image)


async def _run_one(name: str, image: Path, ground_truth: str | None) -> dict:
    # Decided before the run: two first runs that overlap are both cold.
    cold = _runs.get(name, 0) < WARMUP_RUNS
    try:
        result = await run_in_threadpool(_load_and_run, name, image)
    except EngineUnavailable as exc:
        return {"ok": False, "engine": name, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "engine": name, "error": f"{type(exc).__name__}: {exc}"}
    _runs[name] = _runs.get(name, 0) + 1
    score = cer(ground_truth, result.text) if ground_truth else None
    return {"ok": True, **result.to_dict(), "cer": score, "cold": cold}
