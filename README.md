# OCR_Playground

Internal team playground for trying OCR models on the same Thai documents (invoices, receipts, forms, ID cards, scans, some English) and comparing their output, speed, and character error rate (CER).

## Layout

| Folder | What it is |
|---|---|
| `engines/` | Python package (`uv`). Modules: `engines` (one adapter per OCR model behind one interface), `scoring`, `synth`, `bench`, the HTTP API the web app calls (`api`), and the `ocr` CLI. |
| `web/` | Next.js app, hosted on AWS Amplify (Gen 2). Invite-only Cognito sign-in. Modules in `web/src/modules/`: `auth`, `documents`, `scoring`, `engines`, `playground`. |
| `data/samples/` | Synthetic sample pages, each `<name>.png` with a `<name>.gt.txt` ground truth (and `<name>.meta.json` from `ocr synth`). |
| `models/` | Downloaded model files (git-ignored). |
| `scripts/` | `dev.py` (local dev environment) and `local_cognito.py` (the local sign-in it and the verification skill use). |

## Engines

| Name | Model | Runs on | Output |
|---|---|---|---|
| `openthai-text` | [iapp/OpenThai2.1-OCR-Text](https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118) | Local CPU (ONNX), about 0.5 s/page | Plain text, line boxes |
| `openthai-markdown` | [iapp/OpenThai2.1-OCR-Markdown](https://huggingface.co/iapp/OpenThai2.1-OCR-Markdown-20261118) | Local CUDA GPU with Transformers, or a vLLM server | Markdown, HTML tables |
| `typhoon` | [Typhoon OCR](https://github.com/scb-10x/typhoon-ocr) | vLLM on the GX10 (airgapped), reached through an AWS Lambda | Markdown, HTML tables |

Each engine's dependencies are an optional extra, so you install only what you test. Running an engine locally is optional wherever the model allows it.

### `openthai-text-browser`: no install

The web page can also run OpenThai OCR-Text itself, with [onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/). It needs no Python and no engine API, and the image never leaves the browser. On first use the page downloads about 7 MB of models from Hugging Face, pinned to the commit the Python engine was checked against, and the WASM runtime from jsDelivr. Set `NEXT_PUBLIC_OPENTHAI_TEXT_URL` to serve the models from elsewhere.

`web/src/modules/engines/openthai/` is a full TypeScript port of `LineOCR.read` from iApp's `runtime/line_engine.py`, the copy at model commit `c765cb8` that `worker.ts` pins. It does every step the engine API does: page rotation (sideways and upside down), deskew, detection, splitting lines at wide gaps, the second recognizer for loopless fonts, column-aware reading order, floating marks, the line filter, word boxes, and line boxes mapped back to the page as uploaded. The image steps match OpenCV 5.1 and pyclipper bit for bit. On the 24 pages of the local variety test set (synthetic invoices, damaged copies, real documents) the text is identical to the engine API's on every page. Line boxes agree within 2 px; the only differences come from rounding in the detector network between ONNX Runtime's WebAssembly and CPU builds. It runs in a Web Worker (`worker.ts`), single-threaded, so the tab stays responsive while a page is read.

To check the port against Python on your own pages, run `engines/scripts/openthai_parity.py <images> <out>` (from `engines/`, with `python -m uv run python`), then `npx tsx scripts/openthai-parity.ts <out>` from `web/`. It reports per page whether the text is identical, the CER between the two texts, and the worst box offset. Keep `<out>` outside the repo for real documents.

## Quick start (local)

Needs Python via [uv](https://docs.astral.sh/uv/) and Node 22+.

### Dev environment (one command, no AWS)

```bash
python scripts/dev.py
```

This starts the web app with hot reload on http://localhost:3000, the engine API on http://127.0.0.1:8000 (it restarts when `engines/src` changes), and a local Cognito with one invited user, whose sign-in it prints. Ctrl+C stops all three. It installs the `server` and `openthai-text` extras and the openthai-text model on first run, and the API reads the repo-root `.env` when there is one. To test against a real Cognito pool instead, use `npx ampx sandbox` as below.

To skip the sign-in screen while developing, set `NEXT_PUBLIC_DEV_AUTH_BYPASS=1` (in the shell before `python scripts/dev.py`, or in `web/.env.local`). The header then reads "dev (sign-in bypassed)". The flag only works under `next dev`: `next build` sets NODE_ENV to production, so a deployed build ignores it and its code is dropped from the bundle. The engine API has no auth of its own yet, so the flag changes only the web page.

### Engines from the command line

```bash
cd engines
uv sync --extra server --extra openthai-text
uv run ocr download openthai-text
uv run ocr engines                                   # which engines are ready here
uv run ocr run ../data/samples/synthetic-invoice-001.png -e openthai-text
uv run ocr bench ../data/samples -e openthai-text    # CER + latency, CSV in results/
uv run ocr serve                                     # API on http://127.0.0.1:8000
```

For the vLLM engines, copy `.env.example` to `.env`, fill in the URLs, and run with `uv run --env-file ../.env ocr serve`.

`openthai-markdown` loads iapp's `nemotron_parse` client from the downloaded model folder (it is not on PyPI). The download is about 2.4 GB; the speculative-decoding draft, benchmark data and README images are skipped. With no `OPENTHAI_MD_BASE_URL` set it runs on this machine's CUDA GPU with Transformers. torch comes from the CUDA 12.6 index on Windows and Linux.

```bash
uv sync --inexact --extra server --extra openthai-markdown --extra openthai-markdown-local
uv run ocr download openthai-markdown
uv run ocr run ../data/samples/synthetic-invoice-001.png -e openthai-markdown
```

Measured on an RTX 4060 Laptop GPU (8 GB): the first page takes about 30 s including about 6 s of weight loading, and later pages 9 to 32 s (median 15 s), since the model writes the page one token at a time. On the 20 `ocr synth` pages its mean CER was 2.9% against 2.0% for `openthai-text`, but the gap is mostly reading order, not misreads. On `synthetic-invoice-en-004` it read every character (CER 13%) and placed a side block after the customer block, while the ground truth interleaves them line by line. It reads looped-less Thai fonts much better (2.3% against 10.7% on `synthetic-invoice-002`).

To use a vLLM server instead (for example on the GX10), set `OPENTHAI_MD_BASE_URL` in `.env`; only the `openthai-markdown` extra is needed then. That path is still untested, as no vLLM server was available.

### Web app against a real Cognito pool

```bash
cd web
npm install
npx ampx sandbox          # deploys a personal Cognito pool, writes amplify_outputs.json
cp .env.example .env.local
npm run dev               # http://localhost:3000
```

Sign-up is disabled. An admin adds users in the Cognito console (or `aws cognito-idp admin-create-user`).

## Checks

CI runs these on every pull request. Run them before you push:

```bash
cd web && npm run typecheck && npm run lint && npm test && npm run build
cd engines && uv run lint-imports && uv run pytest
```

Both apps are split into modules with enforced boundaries: `web/eslint.config.mjs` for the web app, and `[tool.importlinter]` in `engines/pyproject.toml` for the engines. `CLAUDE.md` says which module owns what.

## Synthetic samples

`ocr synth` makes fake Thai documents with exact ground truth, ready for `ocr bench`:

```bash
uv sync --extra synth
uv run ocr synth -n 20                         # all kinds, into data/samples
uv run ocr synth -n 5 -k receipt -k id-card --quality scan --seed 1
```

| Option | Values |
|---|---|
| `--kind` / `-k` | `invoice`, `invoice-en` (English labels, Thai customer), `receipt`, `form`, `id-card`. Default: all, round-robin. |
| `--quality` | `clean`, `scan` (skew, uneven paper, blur, resolution loss, noise, JPEG), or `mixed` (default). |
| `--seed` | Same seed and same fonts give the same pages. |
| `--font` | Font files to use. Default: every font on the machine that covers Thai, Latin and digits, or those under `OCR_FONT_DIRS`. |

Each page writes `synthetic-<kind>-NNN.png`, `.gt.txt` (one line per printed row) and `.meta.json` (font, quality, seed), numbered after the ones already in the folder.

Text is shaped with HarfBuzz, not Pillow. Pillow without libraqm draws a tone mark over an upper vowel in the same spot, so `เพิ่ม` prints as `เพิม` and the page disagrees with its own ground truth. `tests/test_synth.py` checks the stacking in every font found.

All data is made up: names and companies are combined from word lists, emails use `example.com`, 13-digit ID and tax numbers fail their checksum on purpose, and ID cards say SPECIMEN and have no emblem. On Linux, install Thai fonts (`fonts-thai-tlwg`) or point `OCR_FONT_DIRS` at a folder of `.ttf` files.

## Scoring

`CER = edit distance / reference length`, computed after dropping Markdown/HTML markup, normalizing to NFC (and decomposed sara am to ำ), and removing all whitespace. Thai has no word spaces and engines disagree on where to put them, so spaces would measure layout, not reading.

## Data rules

Only synthetic or redacted documents go into this playground: no real ID cards, invoices, or customer data, in git or in AWS. Use `ocr synth` for test pages. Keep any real document you need to try locally in `data/sensitive/`, which git ignores, and never upload it to the hosted site.

## Decisions and open questions

Decided (2026-11-25):

- Web on Amplify, Cognito invite-only sign-in.
- Both OpenThai versions plus Typhoon. Local running optional per engine.
- Typhoon runs on vLLM in an airgapped network, exposed through an AWS Lambda.

Open:

- **Typhoon Lambda contract** (teammate's project): request/response shape, auth, same AWS account or not, timeout. If it passes through the OpenAI-compatible API, the `typhoon` engine works by pointing `TYPHOON_BASE_URL` at it.
- **API keys**: whether the playground issues personal keys for scripts, holds upstream secrets only, or both. Waiting on the Lambda details.
- **Cloud OCR API**: the hosted site needs the engine API deployed (planned: a Python container Lambda behind the Amplify backend, uploads via S3 to stay under Lambda's 6 MB request limit, one page per request).
