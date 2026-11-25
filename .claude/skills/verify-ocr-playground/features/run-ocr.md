# Run OCR

A signed-in teammate adds one or more images or PDFs (click or drag and drop) and sees them in the page list at once, one page per image and per PDF page, while PDF pages render in the background. They pick engines from a list that marks unavailable ones with the reason, optionally paste ground truth per page, and run, without waiting for PDFs to finish. Pages are read one at a time. Each engine gets a result card per page with its text, latency, output format, and CER when ground truth was given. Choosing a page in the list shows its preview and its results.

## Sub-features

- `ocr-engine-list` lists every engine. Unavailable engines are disabled and show their reason.
- `ocr-choose-page` adds the chosen images as pages, previews the selected one, and enables `Run N engine(s)` (`… on N pages` when there are several).
- `ocr-pdf` renders every page of a PDF at 200 DPI in the browser with pdf.js, in the background. The PDF shows up at once as one entry named after the file. Once pdf.js opens it, that entry becomes `<file>.pdf · page 1` and pages 2..N appear after it. Each page starts out preparing (a grey placeholder thumbnail, with `Preparing` in its accessible name, and `Preparing page…` as the preview). Thumbnails fill in one by one, in page order.
- `ocr-pdf-failed` turns a PDF that can't be opened into an entry with `!` and `Couldn't open this PDF. It may be damaged or password-protected.` It can be removed, and Run skips it.
- `ocr-multi-file` takes several files in one pick or drop, and adds to the existing list. Other file types are refused with `Couldn't add <name> — only images and PDFs work.`
- `ocr-drag-drop` accepts files dropped on the dashed box, which shows a solid accent border while files are over it.
- `ocr-remove` removes one page with its `×` button (`Remove <label>`) or all with `Remove all`, dropping their results. Both work at any time, also while pages are preparing or a run is going. Removing every page of a PDF stops its rendering.
- `ocr-run` reads pages in list order. Run is enabled once there is a page that hasn't failed, even if it is still preparing. The run waits for a preparing page (`Preparing page n of N…`), skips failed ones, and also reads pages added during the run, so `N` in `Reading page n of N…` can grow. Each page gets one result card per selected engine, with text, latency in ms, and format, and a `Done` marker in the list.
- `ocr-switch-page` shows the selected page's label above its result cards, and its own ground truth.
- `ocr-cer` adds `CER x.x%` to each card when ground truth is filled in.
- `ocr-api-down` shows an alert naming the engine API URL when the API is unreachable. `openthai-text-browser` stays listed and runnable.
- `ocr-browser-engine` runs `openthai-text-browser` in a Web Worker with onnxruntime-web, sending nothing to the engine API and leaving the page responsive.

## How to get to it (user POV)

- Sign in. The playground is the only page.
- Drop images or PDFs on the dashed box, or click it to choose files. Choose a page in the list to see it, then choose `Run`.

## Driving it with agent-browser

Preconditions:

- Signed in as in `sign-in.md` (`main` exists).
- `verify.py doctor` shows `openthai-text=ready`.

- **Engine list.** Take `agent-browser snapshot`. The `Engines` group lists `openthai-text-browser` first, checked, then checkbox `openthai-text …` checked. `openthai-markdown` and `typhoon` are disabled, with reasons that start `missing`.
- **Choose page.** Run `agent-browser upload 'input[type=file]' "$PWD/data/samples/synthetic-invoice-001.png"`, with a forward-slash absolute path. Then `agent-browser eval "JSON.stringify({pages: document.querySelectorAll('ul[aria-label=Pages] > li').length, preview: !!document.querySelector('main img[alt^=Preview]')})"` returns `{"pages":1,"preview":true}`.
- **Several files and PDF.** `agent-browser upload` takes several paths. A 2-page test PDF can be made with Pillow, kept out of git: `python -c "from PIL import Image; i=Image.open('data/samples/synthetic-invoice-001.png').convert('RGB'); i.save('<scratch>/two-page.pdf','PDF',save_all=True,append_images=[i])"`. Upload the PNG and the PDF together. The list shows 3 pages, the last two `two-page.pdf · page 1` and `· page 2`. Read the labels with `[...document.querySelectorAll('ul[aria-label=Pages] li > button:first-child')].map(b=>b.textContent)`.
- **Drag and drop.** agent-browser has no file drag, so dispatch a synthetic drop with `eval`: fetch a file, put it in a `DataTransfer`, and fire `drop` on the box. `agent-browser eval "(async()=>{const b=await (await fetch('<url of an image>')).blob(); const dt=new DataTransfer(); dt.items.add(new File([b],'dropped.png',{type:'image/png'})); document.querySelector('section[aria-label=Input] label:has(input[type=file])').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); return 'ok'})()"`. A preview `img`'s `src` (an object URL) works as the image URL. The list gains `dropped.png`.
- **Background PDF rendering.** `agent-browser upload` returns only after the page has settled, so a small PDF is fully rendered by then. Measure from the page instead. Before the upload, run `eval` with a capture-phase `change` listener on `document` that records the page-list count in `requestAnimationFrame`, and a `MutationObserver` on `main` that logs `{t, items, ready}` whenever the count of `li` or of `li img` changes. Thumbnails are `img` only once ready. A 12-page PDF shows 1 entry in the next frame, 12 entries within about 15 ms (about 100 ms if pdf.js wasn't warmed by hovering the drop box first), and `ready` climbing to 12 over 0.5 to 2 s depending on page size.
- **Preparing state.** A PDF that renders long enough to watch: make 60 pages with Pillow at the default 72 DPI (3444 × 2111 px each at 200 DPI, about 10 s). Upload it, click a late page's button, then screenshot. Preparing entries have the accessible name `<file>.pdf · page <n> Preparing`. The preview shows `Preparing page…`. With `agent-browser set media dark reduced-motion`, a preparing thumbnail's computed `animationName` is `none`.
- **Run while preparing.** To click Run before rendering finishes, keep the uploaded `File` (stash `e.target.files` in the capture listener), drop it again with a synthetic `DragEvent('drop')` (see Drag and drop), and click the Run button in the same `eval`. The button reads `Preparing page 1 of 1…`, then `Preparing page 1 of 12…`, then `Reading page 1 of 12…`. Upload a PNG mid-run and `N` grows by one. At the end every page has `Done`, and `engine.log` gains one `POST /ocr` per page.
- **Remove.** Click `button[aria-label="Remove two-page.pdf · page 2"]` (or by snapshot ref). The page count drops by one. `Remove all` empties the list. Both also work mid-render and mid-run. To prove nothing leaks, wrap `URL.createObjectURL`/`revokeObjectURL` in `eval` to count live `image/*` URLs. The count equals the number of ready pages after any removal, and is 0 after `Remove all`. Removing the page being read drops its result, so the list never shows `Done` for it, though its `POST /ocr` still appears in `engine.log`. After removing a whole large PDF mid-render, `longtask` entries stop (each large page costs one).
- **Failed PDF.** Upload a file named `broken.pdf` that holds `%PDF-1.4 junk`, plus a `.txt`. The list shows `broken.pdf` with the `Couldn't open this PDF…` message. The notice reads `Couldn't add notes.txt — only images and PDFs work.` Run skips the failed entry.
- **Ground truth.** Run `agent-browser fill 'section[aria-label="Input"] textarea' "$(cat data/samples/synthetic-invoice-001.gt.txt)"`. `agent-browser eval "document.querySelector('textarea').value.split('\n')[0]"` returns `ใบกำกับภาษี / ใบเสร็จรับเงิน`.
- **Run.** Run `agent-browser click 'section[aria-label="Input"] > button'`. With several pages, wait until the button text starts with `Run` again: `agent-browser wait --fn "document.querySelector('section[aria-label=Input] > button').textContent.startsWith('Run')"`. With one page, `agent-browser wait 'section[aria-label="Results"] article'` is enough.
- **Result.** Run `agent-browser eval "JSON.stringify([...document.querySelectorAll('section[aria-label=Results] article')].map(a=>({engine:a.querySelector('h2').textContent, stats:a.querySelector('header p')?.textContent, firstLine:a.querySelector('pre')?.textContent.split('\n')[0]})))"`. It returns two cards, `openthai-text-browser` then `openthai-text`, with the same text. Each card's stats match `<n> ms · CER 1.0% · text` and whose first line is `ใบกำกับภาษี / ใบเสร็จรับเงิน`. At commit c13b953 the CER was 1.0%. A large change means the engine or the metric changed.
- **Switch page.** Each page's list button gets a `Done` marker. Click another page's button. `section[aria-label=Results] > h2` changes to its label, and the cards change to that page's results.
- **Side effect.** `.verify/logs/engine.log` gains one `"POST /ocr HTTP/1.1" 200 OK` per page.
- **Browser engine alone.** Uncheck every API engine (`openthai-text`, and `openthai-markdown` when it is available, which is slow and uses the GPU), then Run. One card, `openthai-text-browser`, reads `<n> ms · CER 1.0% · text` (about 800 ms warm). `grep -c 'POST /ocr' .verify/logs/engine.log` is unchanged, which proves the image stayed in the browser. The worker's model downloads do not appear in the page's resource timings. To check responsiveness, run `agent-browser eval "window.__lt=[]; new PerformanceObserver(l=>l.getEntries().forEach(e=>__lt.push(e.duration))).observe({type:'longtask'}); 1"` before Run. Afterwards `JSON.stringify(window.__lt)` is `[]`. Before the worker it held one task of about 800 ms.
- **Proof.** Save `.verify/evidence/run-ocr/01-page-chosen.png` after upload, then `02-results.png`, `agent-browser snapshot > .verify/evidence/run-ocr/02-results.aria.txt`, and the `eval` output.

## Gotchas

- Use forward slashes in the upload path. A backslash path freezes the tab.
- Results replace the previous run. Adding files keeps existing pages and results. Removing a page drops its results.
- Ground truth belongs to the selected page. Fill it after selecting the page.
- pdf.js parses in its own Web Worker (`pdf.worker.min.mjs`). Hovering, focusing, or dragging over the drop box starts loading it (a ~130 kB chunk). Turbopack hashes the chunk name, so look for a new `/_next/static/chunks/*.js` resource after the hover, not for `pdf` in the name.
- Page drawing stays on the main thread. pdf.js yields every 15 ms, and the importer yields between pages. The one unsliced step is `canvas.toBlob`'s GPU readback (`Canvas2DResourceProvider::Snapshot` → `ReadbackImagePixels` in a trace). Measured on this machine: 1722 × 1056 px pages had no long tasks, A4 at 200 DPI (1654 × 2339) had 1 to 4 tasks of 50 to 65 ms per 12 pages, and 3444 × 2111 px had one 58 to 170 ms task per page.
- `ocr-api-down` needs the engine API stopped. Don't kill the engine process by name. Run `down`, then `up`, and reproduce by blocking the API URL if needed. Report it unverified if you did not reproduce it.
- `ocr-cer` ignores whitespace and Markdown or HTML markup by design. See README "Scoring".
- `openthai-text-browser` downloads its models from Hugging Face and its WASM runtime from jsDelivr on first use, so the verification browser needs internet. If its card shows an `HTTP` error, check those hosts before the code. Its latency excludes the download.
- The first OCR call loads the ONNX model, so it is slower (about 1.7 s) than later calls (about 0.5 s). Compare latency only across warm calls.
