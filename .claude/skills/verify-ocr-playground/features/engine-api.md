# Engine API

The web app calls an HTTP API that lists engines and runs OCR. Scripts can call it directly. It answers which engines are ready, and it OCRs an uploaded image with the requested engines, adding CER when ground truth is sent.

## Sub-features

- `api-engines` is `GET /engines`. It returns `[{name, description, available, reason}]`.
- `api-ocr` is `POST /ocr` (multipart `file`, repeated `engines`). It returns one object per engine, `{ok: true, engine, text, format, latency_ms, lines, cer}` or `{ok: false, engine, error}`.
- `api-cer` adds a numeric `cer` when the `ground_truth` form field is present.
- `api-unknown` answers HTTP 400 for an engine name that doesn't exist.
- `api-cors` allows only the origins in `OCR_CORS_ORIGINS` (verification sets `http://localhost:3100`).

## How to get to it (user POV)

- `http://127.0.0.1:8100` while a verification instance is up. Local development uses `uv run ocr serve` on port 8000.

## Driving it with HTTP

Preconditions:

- `verify.py doctor` exits 0.

- **Engines.** Run `curl -s http://127.0.0.1:8100/engines`. HTTP 200. The JSON has `openthai-text` with `available: true`.
- **OCR with ground truth.** Send UTF-8 ground truth from a file, not from a shell argument. Run `curl -s -F file=@data/samples/synthetic-invoice-001.png -F engines=openthai-text -F "ground_truth=<data/samples/synthetic-invoice-001.gt.txt" http://127.0.0.1:8100/ocr`. HTTP 200. `[0].ok` is `true` and `[0].cer` is `0.01`.
- **Unavailable engine.** Add `-F engines=typhoon`. The second object is `{"ok": false, "engine": "typhoon", "error": "typhoon: missing typhoon_ocr; ..."}`, and the first is unaffected.
- **Unknown engine.** Run `curl -s -o /dev/null -w "%{http_code}" -F file=@data/samples/synthetic-invoice-001.png -F engines=nope http://127.0.0.1:8100/ocr`. It prints `400`.
- **CORS.** Run `curl -s -i -X OPTIONS http://127.0.0.1:8100/ocr -H "Origin: http://localhost:3100" -H "Access-Control-Request-Method: POST"`. It has `access-control-allow-origin: http://localhost:3100`. With `Origin: http://evil.example` the header is absent.
- **Proof.** Save each command and response to `.verify/evidence/engine-api/<step>.txt`.

## Gotchas

- `-F "ground_truth=<file"` sends the file's contents as a plain form field, in the right encoding. `-F ground_truth=@file` uploads it as a file part, and the API answers 422. `--form-string "ground_truth=$(cat file)"` from Git Bash mangles Thai, and CER jumps to about 0.7.
- The web journey in `run-ocr.md` is the user path. Proving the API alone does not prove the page works.
