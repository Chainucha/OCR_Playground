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


@app.get("/engines")
def list_engines() -> list[dict]:
    return engine_status()


@app.post("/ocr")
async def ocr(
    file: Annotated[UploadFile, File()],
    engines: Annotated[list[str], Form()],
    ground_truth: Annotated[str | None, Form()] = None,
) -> list[dict]:
    unknown = [e for e in engines if e not in engine_names()]
    if unknown:
        raise HTTPException(400, f"Unknown engines: {', '.join(unknown)}")
    suffix = Path(file.filename or "upload.png").suffix or ".png"
    with tempfile.TemporaryDirectory() as tmp:
        image = Path(tmp) / f"page{suffix}"
        image.write_bytes(await file.read())
        results = []
        for name in engines:
            try:
                result = await run_in_threadpool(get_engine(name).run, image)
                score = cer(ground_truth, result.text) if ground_truth else None
                results.append({"ok": True, **result.to_dict(), "cer": score})
            except EngineUnavailable as exc:
                results.append({"ok": False, "engine": name, "error": str(exc)})
            except Exception as exc:
                results.append({"ok": False, "engine": name, "error": f"{type(exc).__name__}: {exc}"})
        return results
