# OCR Playground verification map

This folder is the maintained source for verifying what OCR Playground users can do. Read this index first, then use the matching feature file as the recipe.

## Baseline preconditions

- `python .claude/skills/verify-ocr-playground/scripts/verify.py up` has finished and printed `Up at http://localhost:3100`.
- `verify.py doctor` exits 0.
- `AGENT_BROWSER_SESSION=ocr-verify` is exported for every `agent-browser` command.
- The seeded user is `verify@example.com` with password `Verify-Pass-123!`.
- The sample page is `data/samples/synthetic-invoice-001.png`, with ground truth in `data/samples/synthetic-invoice-001.gt.txt`.
- Never drive an instance this run did not start.

## Driving conventions

- Start from a fresh `open http://localhost:3100` unless a recipe says otherwise.
- Prefer the selectors in the SKILL.md table and snapshot refs over coordinates.
- Use forward-slash file paths on every OS.
- Run engine CLI commands from `engines/` with `uv run` (or `python -m uv run`).

## Proof and skip reporting

- Store artifacts under `.verify/evidence/<feature-id>/`, named in step order (`01-...png`, `02-...aria.txt`).
- Web proof is a screenshot plus an accessibility snapshot of the resulting state, plus the values read with `agent-browser eval`.
- Side-effect proof is the matching line in `.verify/logs/engine.log` or `.verify/logs/cognito.log`.
- CLI proof is the command, stdout, stderr, and exit code.
- Report an unreachable path with the attempted command and the unmet precondition. Do not report it as verified through another path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then has exactly four H2 sections, in this order:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with agent-browser` (or with the CLI or HTTP for non-web features)
4. `Gotchas`

## Features

- [Sign in](./sign-in.md). Invite-only email sign-in, no sign-up, and sign-out.
- [Run OCR](./run-ocr.md). Choose a page, pick engines, run, and read text, latency, and CER per engine.
- [Engine CLI](./cli.md). `ocr engines`, `run`, `bench`, `download`, and `synth` from a terminal.
- [Engine API](./engine-api.md). `GET /engines` and `POST /ocr`, which the web app calls.
