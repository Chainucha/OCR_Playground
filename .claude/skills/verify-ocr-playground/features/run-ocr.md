# Run OCR

A signed-in teammate chooses a page image, sees it previewed, picks engines from a list that marks unavailable ones with the reason, optionally pastes ground truth, and runs. Each engine gets a result card with its text, latency, output format, and CER when ground truth was given.

## Sub-features

- `ocr-engine-list` lists every engine. Unavailable engines are disabled and show their reason.
- `ocr-choose-page` previews the chosen image and enables `Run N engine(s)`.
- `ocr-run` shows one result card per selected engine, with text, latency in ms, and format.
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
- **Result.** Run `agent-browser eval "JSON.stringify([...document.querySelectorAll('section[aria-label=Results] article')].map(a=>({engine:a.querySelector('h2').textContent, stats:a.querySelector('header p')?.textContent, firstLine:a.querySelector('pre')?.textContent.split('\n')[0]})))"`. It returns two cards, `openthai-text-browser` then `openthai-text`, with the same text. Each card's stats match `<n> ms · CER 1.0% · text` and whose first line is `ใบกำกับภาษี / ใบเสร็จรับเงิน`. At commit c13b953 the CER was 1.0%. A large change means the engine or the metric changed.
- **Side effect.** `.verify/logs/engine.log` gains `"POST /ocr HTTP/1.1" 200 OK`.
- **Browser engine alone.** Uncheck every API engine (`openthai-text`, and `openthai-markdown` when it is available, which is slow and uses the GPU), then Run. One card, `openthai-text-browser`, reads `<n> ms · CER 1.0% · text` (about 800 ms warm). `grep -c 'POST /ocr' .verify/logs/engine.log` is unchanged, which proves the image stayed in the browser. The worker's model downloads do not appear in the page's resource timings. To check responsiveness, run `agent-browser eval "window.__lt=[]; new PerformanceObserver(l=>l.getEntries().forEach(e=>__lt.push(e.duration))).observe({type:'longtask'}); 1"` before Run. Afterwards `JSON.stringify(window.__lt)` is `[]`. Before the worker it held one task of about 800 ms.
- **Proof.** Save `.verify/evidence/run-ocr/01-page-chosen.png` after upload, then `02-results.png`, `agent-browser snapshot > .verify/evidence/run-ocr/02-results.aria.txt`, and the `eval` output.

## Gotchas

- Use forward slashes in the upload path. A backslash path freezes the tab.
- Results replace the previous run. Choosing a new file clears them.
- `ocr-api-down` needs the engine API stopped. Don't kill the engine process by name. Run `down`, then `up`, and reproduce by blocking the API URL if needed. Report it unverified if you did not reproduce it.
- `ocr-cer` ignores whitespace and Markdown or HTML markup by design. See README "Scoring".
- `openthai-text-browser` downloads its models from Hugging Face and its WASM runtime from jsDelivr on first use, so the verification browser needs internet. If its card shows an `HTTP` error, check those hosts before the code. Its latency excludes the download.
- The first OCR call loads the ONNX model, so it is slower (about 1.7 s) than later calls (about 0.5 s). Compare latency only across warm calls.
