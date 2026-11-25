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
    from ocr_playground.engines import model_downloads

    downloads = model_downloads()
    if name not in downloads:
        raise typer.BadParameter(f"Downloadable: {', '.join(downloads)}")
    source = downloads[name]
    path = snapshot_download(source.repo, local_dir=MODELS_DIR / name, ignore_patterns=source.ignore)
    typer.echo(f"Downloaded {source.repo} to {path}")


@app.command()
def synth(
    count: Annotated[int, typer.Option("--count", "-n", help="Pages to make, spread across the kinds.")] = 10,
    kind: Annotated[list[str] | None, typer.Option("--kind", "-k", help="invoice, invoice-en, receipt, form, id-card; repeat for several. Default: all.")] = None,
    out: Annotated[Path | None, typer.Option(help="Output folder; defaults to data/samples.")] = None,
    quality: Annotated[str, typer.Option(help="clean, scan (skewed, blurred, noisy, JPEG), or mixed.")] = "mixed",
    seed: Annotated[int | None, typer.Option(help="Same seed and fonts give the same pages.")] = None,
    font: Annotated[list[Path] | None, typer.Option(help="Font file; repeat for several. Default: every Thai font found (OCR_FONT_DIRS or the system folders).")] = None,
) -> None:
    """Make synthetic Thai documents with exact ground truth for `ocr bench`."""
    try:
        from ocr_playground.synth import generate
    except ImportError as exc:
        raise typer.BadParameter(f"missing {exc.name}; run `uv sync --extra synth`") from exc
    from ocr_playground.config import SAMPLES_DIR

    if quality not in ("clean", "scan", "mixed"):
        raise typer.BadParameter("quality must be clean, scan, or mixed")
    try:
        made = generate(out or SAMPLES_DIR, count, kind, quality, seed, font)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    for page in made:
        typer.echo(f"{page.image.name:<32} {page.quality:<6} {page.font}")
    typer.echo(f"\nWrote {len(made)} pages to {(out or SAMPLES_DIR).resolve()}")


@app.command()
def serve(
    host: str = "127.0.0.1",
    port: int = 8000,
    reload: Annotated[bool, typer.Option(help="Restart when engine code changes (development).")] = False,
) -> None:
    """Start the HTTP API the web app calls (GET /engines, POST /ocr)."""
    import uvicorn

    src = Path(__file__).resolve().parent
    uvicorn.run("ocr_playground.api:app", host=host, port=port, reload=reload, reload_dirs=[str(src)] if reload else None)


if __name__ == "__main__":
    app()
