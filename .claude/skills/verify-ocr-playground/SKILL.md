---
name: verify-ocr-playground
description: Launch an isolated OCR Playground (Next.js web app with local Cognito sign-in, Python engine API, openthai-text model) and drive it like a user to prove a change works. Use after changing anything in web/ or engines/, before claiming a feature, fix, or engine works, or when asked to verify, demo, or screenshot the playground.
---

# Verify OCR Playground

OCR Playground has three user surfaces. The primary one is the web app: sign in, choose a page image, pick engines, run, and compare results. The other two are the `ocr` CLI and the engine HTTP API in `engines/`. The feature map in `features/README.md` lists what to verify and how. Read it before driving anything.

All commands run from the repo root. Paths use forward slashes, including on Windows.

## Launch

```bash
python .claude/skills/verify-ocr-playground/scripts/verify.py up
```

`up` does the following, in order:

1. It refuses to start if `.verify/state.json` exists or if ports 8100, 3100, 5100, or 5101 are in use. It never drives an instance it did not start.
2. It installs dependencies. It runs `uv sync --inexact --extra server --extra openthai-text` in `engines/`. `--inexact` keeps extras that other work installed. It downloads `models/openthai-text` if missing and runs `npm install` if `web/node_modules` is missing.
3. It starts local Cognito on `http://127.0.0.1:5100`. This is moto in-process with a CORS proxy, seeded with an invite-only pool and the user `verify@example.com` / `Verify-Pass-123!`.
4. It starts the engine API on `http://127.0.0.1:8100`, with CORS for the web origin.
5. It builds the web app into `web/.next-verify`, with `NEXT_DIST_DIR` and the `NEXT_PUBLIC_*` variables pointing at the two services above. Then it runs `next start` on `http://localhost:3100`.

Ready means `up` printed `Up at http://localhost:3100` and exited 0. A cold first run takes several minutes for the dependency install and the model download. A warm run takes about 1 minute, mostly the web build.

Requirements are Python with uv (`uv` on PATH or `python -m uv`), Node 20+ with npx, `agent-browser` on PATH, and network access for the first dependency install.

## Doctor

```bash
python .claude/skills/verify-ocr-playground/scripts/verify.py doctor
```

The check is read-only. It prints one `OK` or `FAIL` line per check and exits 1 on any failure. The checks are the following:

- each started process is alive
- `GET /engines` answers and `openthai-text` is ready
- the web root serves `<title>OCR Playground</title>`
- Cognito `DescribeUserPool` finds the seeded pool
- the git checkout matches what `up` built (`build` line)

Run it first whenever anything looks off. If the `build` line fails, the web bundle is stale. Run `down`, then `up`, before proving a web change.

## Drive

Use `agent-browser` in its own session so you never touch another agent's browser.

```bash
export AGENT_BROWSER_SESSION=ocr-verify
agent-browser set viewport 1400 900
agent-browser open http://localhost:3100
```

Stable handles, all in the current code:

| What | Selector |
|---|---|
| Sign-in email | `input[name="username"]` |
| Sign-in password | `input[name="password"]` |
| Sign-in submit | `button[type="submit"]` |
| Signed-in marker | `main` (exists only after sign-in) |
| Sign out | `header button` |
| Page image input | `input[type=file]` |
| Model picker | button named `N model(s)` (opens a popover of checkboxes) |
| How to run | radios `One at a time` / `All at once` in the same popover |
| Warm-up note | `#getting-ready` (empty once every model is ready) |
| Correct text (ground truth) | button `Add the correct text`, then `#correct-text-input` |
| Read button | button whose name starts `Read with` |
| Results | `#results`; progress line `#results [role=status]` |
| Score cards | `#results [data-slot=card]` outside `[role=region]` (model name in `h3`) |
| Text columns | `[role=region] [data-slot=card]`; mistakes are `del` (page says) and `ins` (model wrote) |
| A model failed | `#results [role=alert]` in its score card |
| API unreachable notice | `main > p[role=status]` |

The page shows friendly model names, not engine ids: `openthai-text-browser` is `OpenThai Quick · Private`, `openthai-text` is `OpenThai Quick` (mapping in `web/src/lib/models.ts`). Checkbox names start with the friendly name. Take `agent-browser snapshot` and click by ref (`agent-browser click @e17`), or `agent-browser find role button click --name "Read with 2 models"`.

For a worked sequence, see `features/run-ocr.md`. The CLI and API recipes are in `features/cli.md` and `features/engine-api.md`.

## Evidence

Write proof to `.verify/evidence/<feature-id>/`. `down` never deletes this folder, and git ignores it.

- Web proof is a screenshot after the user action and an accessibility snapshot (`agent-browser snapshot > <file>.aria.txt`). Also record the structured values you assert on, read with `agent-browser eval`.
- Side-effect proof comes from the request in `.verify/logs/engine.log` (`POST /ocr ... 200`). For sign-in, use `.verify/logs/cognito.log`.
- CLI proof is the command, stdout, stderr, and exit code.

Proof standards:

- Drive the real user path: the sign-in form, the file input, the Run button. Don't call internal setters or post to the API in place of the page.
- Capture the action and the resulting state, not only the final screen.
- Local Cognito is a mock at the Cognito boundary. It proves the sign-in UI and the SRP request flow. It does not prove password checks or the real AWS pool. See `features/sign-in.md`.
- Report a journey you could not run, with its unmet precondition. Never report it as verified through a different path.

## Cleanup

```bash
AGENT_BROWSER_SESSION=ocr-verify agent-browser close
python .claude/skills/verify-ocr-playground/scripts/verify.py down
```

`down` kills only the process trees whose PIDs `up` recorded, in reverse start order. It removes `web/amplify_outputs.json` only if `up` created it as a placeholder, and it removes `.verify/state.json`. It keeps `.verify/evidence/` and `.verify/logs/`. Run `down` after every failed `up` as well. A failed `up` leaves its processes running and tells you to.

## Helpers

- `scripts/verify.py up|doctor|down`. Standard library only. Run it with any Python 3.11+.
- `scripts/local_cognito.py <out.json> <proxy_port>` at the repo root, shared with `scripts/dev.py`. `up` starts it through `uv run --with moto[server] --with boto3`. You should not need to run it yourself.

## Gotchas

- Next.js 16 allows one `next dev` per checkout. A developer's dev server on port 3000 doesn't block verification, because verification uses `next build` plus `next start` into `.next-verify`. Never kill a dev server you did not start.
- `NEXT_PUBLIC_*` values are baked in at build time. After changing web code or env, run `down` and then `up`. Doctor's `build` line catches a stale bundle.
- `agent-browser upload` with a backslash Windows path (`D:\...`) freezes the tab. Use forward slashes (`D:/Kim/.../page.png`).
- The first `next build` with a new dist dir adds `.next-verify/types/**/*.ts` to `web/tsconfig.json`. That edit is expected and committed.
- `openthai-markdown` and `typhoon` show as unavailable in this setup. They need a vLLM server and env settings (`.env.example`). Don't report them as verified unless doctor shows them ready.
