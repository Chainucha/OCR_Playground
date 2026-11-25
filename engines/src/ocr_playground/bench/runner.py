import csv
import statistics
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass
from pathlib import Path

from ocr_playground.engines import Engine
from ocr_playground.scoring import cer

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp"}
GROUND_TRUTH_SUFFIXES = (".gt.txt", ".gt.md")


@dataclass
class Sample:
    image: Path
    ground_truth: str


@dataclass
class Row:
    sample: str
    engine: str
    cer: float | None
    latency_ms: float | None
    error: str | None


def find_samples(root: Path) -> list[Sample]:
    samples = []
    for image in sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES):
        for suffix in GROUND_TRUTH_SUFFIXES:
            gt = image.with_name(image.stem + suffix)
            if gt.exists():
                samples.append(Sample(image, gt.read_text(encoding="utf-8")))
                break
    return samples


def run_bench(
    samples: Iterable[Sample], engines: list[Engine], on_row: Callable[[Row], None] = lambda row: None
) -> list[Row]:
    rows = []
    for sample in samples:
        for engine in engines:
            try:
                result = engine.run(sample.image)
                row = Row(sample.image.name, engine.name, cer(sample.ground_truth, result.text), result.latency_ms, None)
            except Exception as exc:
                row = Row(sample.image.name, engine.name, None, None, f"{type(exc).__name__}: {exc}")
            on_row(row)
            rows.append(row)
    return rows


def write_csv(rows: list[Row], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(Row.__dataclass_fields__))
        writer.writeheader()
        writer.writerows(asdict(r) for r in rows)


def summarize(rows: list[Row]) -> list[dict]:
    summary = []
    for engine in dict.fromkeys(r.engine for r in rows):
        ok = [r for r in rows if r.engine == engine and r.error is None]
        summary.append({
            "engine": engine,
            "samples": len(ok),
            "errors": sum(1 for r in rows if r.engine == engine and r.error is not None),
            "mean_cer": statistics.fmean(r.cer for r in ok) if ok else None,
            "median_latency_ms": statistics.median(r.latency_ms for r in ok) if ok else None,
        })
    return summary
