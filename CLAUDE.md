# OCR Playground

## Project facts
- What it is: an internal playground for running OCR models on the same Thai documents and comparing their text,
  accuracy, and speed. Users are non-developers, so the page uses plain words (see `README.md`).
- Layout: `web/` is the Next.js app on AWS Amplify. `engines/` is the Python package (`uv`) with the OCR engines,
  the `ocr` CLI, and the engine API that the web app calls. Each is a modular monolith (see below).
- Web stack: Next.js 15 (App Router, `src/`), TypeScript, Tailwind CSS 4, shadcn/ui (`src/components/ui/`), Vitest,
  Cognito sign-in through an Amplify Gen 2 backend (`web/amplify/`). Node 22.
- Run everything locally: `python scripts/dev.py` (web, engine API, local Cognito).
- Check web: in `web/`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- Check engines: in `engines/`, `uv run lint-imports`, `uv run pytest`.
- CI runs both sets on every PR (`.github/workflows/ci.yml`). Health after a deploy: `/api/health`.
- Started from `DA-CPD-Synnex/template-lite`, without its dev cycle (`/cycle`), database, or Entra login.

## Where things go (web)
- `src/app/`: routes only. A page imports one module and renders it.
- `src/modules/<name>/`: one module per area. Other code imports a module only through its `index.ts`.
  - `auth`: Cognito sign-in and the signed-in user.
  - `documents`: the pages a user adds (images, PDF pages rendered with pdf.js).
  - `scoring`: accuracy (CER) and the word-level diff.
  - `engines`: the model list, friendly names, the engine API client, and the in-browser OpenThai engine.
  - `playground`: the compare page, built from the modules above.
- `src/modules/<name>/core/`: the module's rules in plain TypeScript, with tests next to them. No React, Next.js,
  or browser library imports. Types from another module's `index.ts` are allowed.
- `src/components/ui/` and `src/lib/`: shared code. It must not import modules or routes.
- `eslint.config.mjs` enforces all of the above. A new module, or a new dependency between modules, goes in its
  `MODULES` map first.

## Where things go (engines)
- Modules under `engines/src/ocr_playground/`: `cli` and `api` (entry points), `bench`, then `engines`, `scoring`,
  and `synth` (independent of each other), then `config` (paths only).
- Code outside a module imports only the module's package (`from ocr_playground.engines import get_engine`).
- `[tool.importlinter]` in `engines/pyproject.toml` enforces the layers and the public entry points.

## Amplify rules
- `amplify.yml` builds `web/` (monorepo `appRoot`). The backend phase deploys Cognito and writes
  `amplify_outputs.json`. The frontend phase builds Next.js.
- Next.js 15 only, as in template-lite: Amplify Hosting does not support 16 yet. No streaming, edge routes or `after()`.
- `NEXT_PUBLIC_*` variables are baked in at build time. The server has no runtime variables today. If it gets one,
  copy `scripts/write-runtime-env.mjs` from template-lite, because Amplify gives env vars to the build only.
- Use `npm install`, not `npm ci`. npm reports the lock file as out of sync because of bundled dependencies in
  `@aws-amplify/data-construct`, even right after a fresh `npm install`.
- `web/amplify_outputs.placeholder.json` lets CI, `scripts/dev.py`, and the verify skill build without a deployed
  user pool.

## Data rules
- Only synthetic or redacted documents go into git or AWS. Use `ocr synth` for test pages.
