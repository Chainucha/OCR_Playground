# OCR_Playground

Internal team playground for trying OCR models on the same Thai documents (invoices, receipts, forms, ID cards, scans, some English) and comparing their output, speed, and character error rate (CER).

## Layout

| Folder | What it is |
|---|---|
| `engines/` | Python package (`uv`). One adapter per OCR model behind one interface, plus a CLI (`ocr`) and an HTTP API the web app calls. |
| `web/` | Next.js app, hosted on AWS Amplify (Gen 2). Invite-only Cognito sign-in. |
| `data/samples/` | Synthetic sample pages, each `<name>.png` with a `<name>.gt.txt` ground truth. |
| `models/` | Downloaded model files (git-ignored). |

## Engines

| Name | Model | Runs on | Output |
|---|---|---|---|
| `openthai-text` | [iapp/OpenThai2.1-OCR-Text](https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118) | Local CPU (ONNX), about 0.5 s/page | Plain text, line boxes |
| `openthai-markdown` | [iapp/OpenThai2.1-OCR-Markdown](https://huggingface.co/iapp/OpenThai2.1-OCR-Markdown-20261118) | vLLM on a GPU (local or GX10) | Markdown, HTML tables |
| `typhoon` | [Typhoon OCR](https://github.com/scb-10x/typhoon-ocr) | vLLM on the GX10 (airgapped), reached through an AWS Lambda | Markdown, HTML tables |

Each engine's dependencies are an optional extra, so you install only what you test. Running an engine locally is optional wherever the model allows it.

## Quick start (local)

Needs Python via [uv](https://docs.astral.sh/uv/) and Node 20+.

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

`openthai-markdown` needs iapp's `nemotron_parse` client, which ships inside the model repo, not on PyPI. Its declared dependencies include PyTorch; the HTTP client path appears not to need it, so these steps skip it (untested so far, as no vLLM server was available):

```bash
uv sync --extra server --extra openthai-markdown
uv run ocr download openthai-markdown
uv pip install --no-deps ../models/openthai-markdown
uv pip install pillow numpy beautifulsoup4
```

Web app:

```bash
cd web
npm install
npx ampx sandbox          # deploys a personal Cognito pool, writes amplify_outputs.json
cp .env.example .env.local
npm run dev               # http://localhost:3000
```

Sign-up is disabled. An admin adds users in the Cognito console (or `aws cognito-idp admin-create-user`).

## Scoring

`CER = edit distance / reference length`, computed after dropping Markdown/HTML markup, normalizing to NFC (and decomposed sara am to ำ), and removing all whitespace. Thai has no word spaces and engines disagree on where to put them, so spaces would measure layout, not reading.

## Data rules

Only synthetic or redacted documents go into this playground: no real ID cards, invoices, or customer data, in git or in AWS. A synthetic-data generator is planned for a later stage.

## Decisions and open questions

Decided (2026-11-25):

- Web on Amplify, Cognito invite-only sign-in.
- Both OpenThai versions plus Typhoon. Local running optional per engine.
- Typhoon runs on vLLM in an airgapped network, exposed through an AWS Lambda.

Open:

- **Typhoon Lambda contract** (teammate's project): request/response shape, auth, same AWS account or not, timeout. If it passes through the OpenAI-compatible API, the `typhoon` engine works by pointing `TYPHOON_BASE_URL` at it.
- **API keys**: whether the playground issues personal keys for scripts, holds upstream secrets only, or both. Waiting on the Lambda details.
- **Cloud OCR API**: the hosted site needs the engine API deployed (planned: a Python container Lambda behind the Amplify backend, uploads via S3 to stay under Lambda's 6 MB request limit, one page per request).
