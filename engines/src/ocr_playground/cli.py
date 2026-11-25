import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Annotated

import typer

from ocr_playground.engines import EngineUnavailable, engine_status, get_engine

app = typer.Typer(no_args_is_help=True, help="Run and compare OCR engines.")


@app.callback()
def _utf8_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

EnginesOpt = Annotated[list[str], typer.Option("--engine", "-e", help="Engine name; repeat for several.")]


def _load(names: list[str]):
    try:
        return [get_engine(n) for n in names]
    except (KeyError, EngineUnavailable) as exc:
        raise typer.BadParameter(str(exc)) from exc


@app.command()
def engines() -> None:
    """Show each engine and whether it is ready to run here."""
    for s in engine_status():
        mark = "ready" if s["available"] else f"unavailable: {s['reason']}"
        typer.echo(f"{s['name']:<20} {mark}")


@app.command()
def run(image: Path, engine: EnginesOpt, as_json: Annotated[bool, typer.Option("--json")] = False) -> None:
    """OCR one image with one or more engines."""
    for e in _load(engine):
        result = e.run(image)
        if as_json:
            typer.echo(json.dumps(result.to_dict(), ensure_ascii=False))
        else:
            typer.echo(f"=== {result.engine} ({result.latency_ms:.0f} ms)\n{result.text}\n")


@app.command()
def bench(
    data: Annotated[Path, typer.Argument(help="Folder of images, each with a <name>.gt.txt beside it.")],
    engine: EnginesOpt,
    out: Annotated[Path | None, typer.Option(help="CSV path; defaults to results/<timestamp>.csv")] = None,
) -> None:
    """Score engines on a folder of images with ground truth (CER, latency)."""
    from ocr_playground.bench import find_samples, run_bench, summarize, write_csv

    samples = find_samples(data)
    if not samples:
        raise typer.BadParameter(f"No images with .gt.txt/.gt.md ground truth under {data}")
    rows = run_bench(samples, _load(engine), on_row=lambda r: typer.echo(
        f"{r.sample:<30} {r.engine:<18} " + (f"CER {r.cer:.3f}  {r.latency_ms:.0f} ms" if r.error is None else r.error)
    ))
    out = out or Path("results") / f"{datetime.now():%Y%m%d-%H%M%S}.csv"
    write_csv(rows, out)
    typer.echo(f"\nWrote {out}")
    for s in summarize(rows):
        cer_text = f"{s['mean_cer']:.3f}" if s["mean_cer"] is not None else "-"
        lat_text = f"{s['median_latency_ms']:.0f} ms" if s["median_latency_ms"] is not None else "-"
        typer.echo(f"{s['engine']:<18} mean CER {cer_text}  median {lat_text}  errors {s['errors']}")


@app.command()
def download(name: Annotated[str, typer.Argument(help="openthai-text or openthai-markdown")]) -> None:
    """Download model files into models/<name>."""
    from huggingface_hub import snapshot_download

    from ocr_playground.config import MODELS_DIR
    from ocr_playground.engines import openthai_markdown, openthai_text

    repos = {"openthai-text": openthai_text.HF_REPO, "openthai-markdown": openthai_markdown.HF_REPO}
    if name not in repos:
        raise typer.BadParameter(f"Downloadable: {', '.join(repos)}")
    path = snapshot_download(repos[name], local_dir=MODELS_DIR / name)
    typer.echo(f"Downloaded {repos[name]} to {path}")


@app.command()
def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    """Start the HTTP API the web app calls (GET /engines, POST /ocr)."""
    import uvicorn

    uvicorn.run("ocr_playground.server:app", host=host, port=port)


if __name__ == "__main__":
    app()
