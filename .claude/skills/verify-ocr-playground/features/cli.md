# Engine CLI

A teammate works with OCR engines from a terminal. They list which engines are ready, OCR one image, score engines on a folder of pages with ground truth, download model files, and generate synthetic test pages.

## Sub-features

- `cli-engines` prints each engine as `ready` or `unavailable: <reason>`.
- `cli-run` prints each engine's text and latency for one image, or JSON with `--json`.
- `cli-bench` prints per-page CER and latency, writes a CSV, and prints a per-engine summary.
- `cli-download` downloads `openthai-text` or `openthai-markdown` into `models/<name>`.
- `cli-synth` writes synthetic pages with `.gt.txt` ground truth.

## How to get to it (user POV)

- From `engines/`, run `uv run ocr <command>`, or `python -m uv run ocr <command>` when `uv` is not on PATH.

## Driving it with the CLI

Preconditions:

- `verify.py up` ran at least once, so the `openthai-text` extra and model are installed. The CLI does not need the running services.

- **Engines.** Run `uv run ocr engines`. Exit code 0. Stdout has `openthai-text        ready` and an `unavailable:` line for each of `openthai-markdown` and `typhoon`.
- **Run.** Run `uv run ocr run ../data/samples/synthetic-invoice-001.png -e openthai-text`. Exit code 0. Stdout starts with `=== openthai-text (` and the next line is `ใบกำกับภาษี / ใบเสร็จรับเงิน`.
- **Bench.** Run `uv run ocr bench ../data/samples -e openthai-text --out ../.verify/evidence/cli/bench.csv`. Exit code 0. Stdout ends with a line starting `openthai-text      mean CER`. The CSV has one row per sample with columns `sample,engine,cer,latency_ms,error`.
- **Bench without data.** Run `mkdir -p ../.verify/evidence/cli/empty` and `uv run ocr bench ../.verify/evidence/cli/empty -e openthai-text`. It exits 2 with `No images with .gt.txt/.gt.md ground truth`.
- **Unknown engine.** Run `uv run ocr run ../data/samples/synthetic-invoice-001.png -e nope`. It exits 2 with `Unknown engine 'nope'`.
- **Proof.** Save the command, stdout, stderr, and exit code for each step to `.verify/evidence/cli/<step>.txt`.

## Gotchas

- Thai output needs UTF-8 stdout. The CLI reconfigures it. If text shows as `?`, the terminal font lacks Thai, not the CLI.
- Don't pass Thai text as a command-line argument from Git Bash to native Windows tools such as curl. It gets mangled. Read it from a file instead.
- `cli-synth` needs `uv sync --inexact --extra synth`. It was added after this map was seeded and has not been driven by this skill yet. Verify it with `uv run ocr synth --help` before relying on it.
- `bench` writes into `results/` by default. Pass `--out` under `.verify/evidence/` for proof.
- `uv sync` without `--inexact` removes extras that other work installed. Always pass `--inexact` in shared checkouts.
