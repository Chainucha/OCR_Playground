# Run OCR

A signed-in teammate chooses a page image, sees it previewed, picks engines from a list that marks unavailable ones with the reason, optionally pastes ground truth, and runs. Each engine gets a result card with its text, latency, output format, and CER when ground truth was given.

## Sub-features

- `ocr-engine-list` lists every engine. Unavailable engines are disabled and show their reason.
- `ocr-choose-page` previews the chosen image and enables `Run N engine(s)`.
- `ocr-run` shows one result card per selected engine, with text, latency, and format. Latency is in seconds and runs from sending the request to receiving the result. Below it, `Engine's own time <n> s. …` gives the engine's processing time alone.
- `ocr-run-mode` is the `How to run` radio group, locked while a run is going. `One at a time` (the default) runs engines in card order. Later cards read `waiting for its turn` until their engine starts, and the line above the cards reads `<n> engines one at a time: total <a> s`. `All at once` starts every engine together. Each card notes `Timed while other engines ran at once, so it may read high.`, and the line reads `<n> engines at once: total <a> s, engine times add up to <b> s`. Either way, each API engine gets its own `POST /ocr`, and a card shows `running… <n> s` from its own start until its result arrives.
- `ocr-stages` adds a `Breakdown · <n.nn> s` disclosure to each card, collapsed by default, holding a stage table. It lists the stages in order without overlap and ends with a `Request to result` total. Every card starts with `Send and receive`: the upload, network and reply, or the hand-off to the browser worker and back. Server engines then show `Receive page`, `Wait to start`, then the engine's own stages, then `Score accuracy` when correct text is given. `openthai-text` reports `Open image`, `Find text lines` and `Read text` (iApp's `timing.det_ms` and `rec_ms`), then `Assemble text`. The browser engine shows the same stage names from its port. Engines that don't report stages show a single `Engine` row. The rows add up to the total within 0.01 s of rounding.
- `ocr-warmup` runs when the page opens. Every available engine loads its model and reads the practice page `web/public/warmup.png` until it has done 2 pages (`WARMUP_RUNS`). Meanwhile its note reads `Getting ready: loading the model and reading a practice page…`, and the Run button reads `Getting engines ready…` and is disabled. `GET /engines` reports each engine's `runs`, so a reload sends no practice pages to an engine that is already warm. A result produced during warm-up, such as after the engine API restarts, notes `Ran during the engine's warm-up, so it may read high.`
- `ocr-cer` adds `CER x.x%` to each card when ground truth is filled in.
- `ocr-api-down` shows an alert naming the engine API URL when the API is unreachable. `openthai-text-browser` stays listed and runnable.
- `ocr-browser-engine` runs `openthai-text-browser` in a Web Worker with onnxruntime-web, sending nothing to the engine API and leaving the page responsive.

## How to get to it (user POV)

- Sign in. The playground is the only page.
- Choose the dashed `Choose a page image` box, then choose `Run`.

## Driving it with agent-browser

Preconditions:

- Signed in as in `sign-in.md` (`main` exists).
- `verify.py doctor` shows `openthai-text=ready`.

- **Engine list.** Take `agent-browser snapshot`. The `Engines` group lists `openthai-text-browser` first, checked, then checkbox `openthai-text …` checked. `openthai-markdown` and `typhoon` are disabled, with reasons that start `missing`.
- **Choose page.** Run `agent-browser upload 'input[type=file]' "$PWD/data/samples/synthetic-invoice-001.png"`, with a forward-slash absolute path. Then `agent-browser eval "JSON.stringify({files: document.querySelector('input[type=file]').files.length, preview: !!document.querySelector('main img')})"` returns `{"files":1,"preview":true}`.
- **Ground truth.** Run `agent-browser fill 'section[aria-label="Input"] textarea' "$(cat data/samples/synthetic-invoice-001.gt.txt)"`. `agent-browser eval "document.querySelector('textarea').value.split('\n')[0]"` returns `ใบกำกับภาษี / ใบเสร็จรับเงิน`.
- **Run.** Run `agent-browser click 'section[aria-label="Input"] > button'` and `agent-browser wait 'section[aria-label="Results"] article'`.
- **Result.** Run `agent-browser eval "JSON.stringify([...document.querySelectorAll('section[aria-label=Results] article')].map(a=>({engine:a.querySelector('h2').textContent, stats:a.querySelector('header p')?.textContent, firstLine:a.querySelector('pre')?.textContent.split('\n')[0]})))"`. It returns two cards, `openthai-text-browser` then `openthai-text`, with the same text. Each card's stats match `<n.nn> s · CER 1.0% · text` and whose first line is `ใบกำกับภาษี / ใบเสร็จรับเงิน`. At commit c13b953 the CER was 1.0%. A large change means the engine or the metric changed.
- **Side effect.** `.verify/logs/engine.log` gains one `"POST /ocr HTTP/1.1" 200 OK` per selected API engine.
- **Warm-up.** Right after `wait 'main'`, attach a `MutationObserver` that logs the Run button's text and `disabled` state and each enabled engine's `small` note. It starts at `Getting engines ready…` with both notes on `Getting ready…`, then flips to `Run 2 engines`. Before any upload, `.verify/logs/engine.log` holds 2 `POST /ocr` lines and `GET /engines` shows `openthai-text` with `runs` 2. After `agent-browser reload`, the count is unchanged once the engines are ready.
- **Run mode.** Before Run, attach a `MutationObserver` to `main` that logs each card's `header p` texts and `document.querySelectorAll('fieldset')[1].disabled` on every change. In `One at a time`, `openthai-text` reads `waiting for its turn` until `openthai-text-browser` has a result, and the fieldset is disabled until the run ends. No card carries the warm-up note. Then select `All at once` and run. `openthai-text-browser` fills in while `openthai-text` still reads `running…`, both cards carry the may-read-high note, and the total is below the sum of engine times.
- **Browser engine alone.** Uncheck every API engine (`openthai-text`, and `openthai-markdown` when it is available, which is slow and uses the GPU), then Run. One card, `openthai-text-browser`, reads `<n.nn> s · CER 1.0% · text` (about 0.8 s). `grep -c 'POST /ocr' .verify/logs/engine.log` is unchanged, which proves the image stayed in the browser. The worker's model downloads do not appear in the page's resource timings. To check responsiveness, run `agent-browser eval "window.__lt=[]; new PerformanceObserver(l=>l.getEntries().forEach(e=>__lt.push(e.duration))).observe({type:'longtask'}); 1"` before Run. Afterwards `JSON.stringify(window.__lt)` is `[]`. Before the worker it held one task of about 800 ms.
- **Proof.** Save `.verify/evidence/run-ocr/01-page-chosen.png` after upload, then `02-results.png`, `agent-browser snapshot > .verify/evidence/run-ocr/02-results.aria.txt`, and the `eval` output.

## Gotchas

- Use forward slashes in the upload path. A backslash path freezes the tab.
- Results replace the previous run. Choosing a new file clears them.
- `ocr-api-down` needs the engine API stopped. Don't kill the engine process by name. Run `down`, then `up`, and reproduce by blocking the API URL if needed. Report it unverified if you did not reproduce it.
- `ocr-cer` ignores whitespace and Markdown or HTML markup by design. See README "Scoring".
- `openthai-text-browser` downloads its models from Hugging Face and its WASM runtime from jsDelivr on first use, so the verification browser needs internet. If its card shows an `HTTP` error, check those hosts before the code. Its latency excludes the download.
- Engines that share hardware slow each other down when they run together. In this setup the browser engine and `openthai-text` both use this machine's CPU. On 2026-11-25, warm runs took about 0.82 s and 1.37 s one at a time, and 1.02 s and 1.55 s all at once. Compare latency only from `One at a time` runs.
- Without warm-up, runs 1 and 2 read about 20 to 25% high on 2026-11-25 (`openthai-text` 1.73 s and 1.72 s, against 1.37 s from run 3). That is why `WARMUP_RUNS` is 2. With page-open warm-up, the first timed run of `openthai-text` read 1.34 s.
- The practice page is the same synthetic invoice this recipe measures. A different page size can still cost a little first-time set-up, so a run on a new page can read slightly high.
