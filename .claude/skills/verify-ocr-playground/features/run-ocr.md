# Run OCR (Side by side)

A signed-in teammate adds one page, picks models, optionally adds the correct text, and presses Read. Each model gets a score card (accuracy, number of mistakes, seconds) and a text column. With correct text, mistakes are marked word by word: `del` is what the page says, `ins` is what the model wrote instead. The page uses friendly model names from `web/src/lib/models.ts`, never engine ids.

## Sub-features

- `ocr-engine-list`: the `N models` popover lists every model. Models the server can't run are disabled with "Not set up on this server yet."
- `ocr-choose-page`: choosing a file shows its thumbnail and name and enables `Read with N models`.
- `ocr-run`: one score card and one text column per selected model, in the picker's order. Each card moves from `Reading… <n> sec` (ticking from its own start) to a result or a plain-language failure. A card's time runs from sending the request to getting the result. When everything has answered, the `#results [role=status]` line ends with `one at a time, <a> sec in total`, or `all at once, <a> sec in total (the separate times add up to <b> sec)`.
- `ocr-run-mode`: the `How to run them` radio group sits in the `N models` popover below the models, and it is locked while a read is going. `One at a time` (the default) reads in card order: later cards say `Waiting for its turn` until their model starts. `All at once` starts every model together, and each card notes `The time may read high: other models were reading at the same time.` Either way, each server model gets its own `POST /ocr`.
- `ocr-stages`: each finished card has a `Where the time went` disclosure, collapsed by default. It holds a table of stages in order, without overlap, ending with `Total`. Every table starts with `Send and receive`. Server models then show `Receive page` and `Wait to start`, then their own stages, then `Score accuracy` when correct text is given. `openthai-text` reports `Open image`, `Find text lines`, `Read text` and `Assemble text`, and the private model shows the same names from its port. Models that don't report stages show one `Engine` row.
- `ocr-warmup`: when the page opens, every available model reads the practice page `web/public/warmup.png` until it has done 2 pages (`WARMUP_RUNS`). Meanwhile its line in the popover reads `Getting ready: reading a practice page…`, the Read button reads `Getting models ready…` and is disabled, and `#getting-ready` explains why. `GET /engines` reports each engine's `runs`, so a reload sends no practice pages to a warm server model. A result read during warm-up notes `The time may read high: the model was still warming up.`
- `ocr-cer`: with correct text, each card shows `xx.x% accurate`, `N mistakes · took x.x sec`. `Fewest mistakes` appears only when one model is strictly ahead.
- `ocr-diff`: `Highlight mistakes` switch, on by default, marks wrong words. Thai words come from `Intl.Segmenter`, so a wrong tone mark is shown inside its word.
- `ocr-api-down`: a notice says only OpenThai Quick · Private is available. That model stays runnable.
- `ocr-browser-engine`: OpenThai Quick · Private runs in a Web Worker and sends nothing to the engine API.

## How to get to it (user POV)

- Sign in. Side by side is the only page.
- Drop a page on the dashed box or choose it, open `Add the correct text` if you have it, then press `Read with N models`.

## Driving it with agent-browser

Preconditions:

- Signed in as in `sign-in.md` (`main` exists).
- `verify.py doctor` shows `openthai-text=ready`.

- **Wait for the model list and warm-up.** The list loads after sign-in, and warm-up starts at once. Until both finish, the buttons read `1 model` or `Getting models ready…`. `agent-browser wait --fn "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Read with 2 models')" --timeout 60000`. To watch the gate itself, attach a `MutationObserver` right after `wait main` that logs the Read button's text and `disabled` state. On 2026-11-25 it went `Getting models ready… [disabled]` then `Read with 2 models [disabled]` (no page chosen yet). Before any upload, `.verify/logs/engine.log` held 2 `POST /ocr` lines and `GET /engines` showed `openthai-text` with `runs` 2.
- **Choose page.** `agent-browser upload 'input[type=file]' "$PWD/data/samples/synthetic-invoice-001.png"` (forward slashes). The dashed box then shows `synthetic-invoice-001.png` and `Change document`, and the button reads `Read with 2 models`.
- **Model list.** `agent-browser find role button click --name "2 models"`, then `agent-browser snapshot -i`. Checkboxes `OpenThai Quick · Private …` and `OpenThai Quick …` are checked. `OpenThai Layout` and `Typhoon` are disabled with "Not set up on this server yet." Press Escape to close.
- **Correct text.** `agent-browser find role button click --name "Add the correct text"`, then `agent-browser fill '#correct-text-input' "$(cat data/samples/synthetic-invoice-001.gt.txt)"`. The toggle now reads `Correct text added`.
- **Read.** `agent-browser find role button click --name "Read with 2 models"`, then `agent-browser wait --fn "document.querySelector('#results [role=status]')?.textContent.includes('in total')" --timeout 90000`.
- **Result.** `agent-browser eval "JSON.stringify({status: document.querySelector('#results [role=status]').textContent, marks: [...document.querySelectorAll('#results del, #results ins')].map(m=>m.tagName+':'+m.textContent)})"`. On 2026-11-25 both models scored `99.0% accurate · 2 mistakes`, there was no `Fewest mistakes` badge (a tie), and the status was `2 finished · one at a time, 2.2 sec in total`. The marks were `DEL:page says ที่` / `INS:model wrote ที` and `DEL:page says มูลค่าเพิ่ม` / `INS:model wrote มูลค่าเพิม` in each column. The legend above the columns holds one more `del`/`ins` pair as an example. A large change means an engine, the metric or the diff changed.
- **One at a time.** Before Read, attach a `MutationObserver` that logs each score card's `p` texts. `OpenThai Quick` reads `Waiting for its turn` until `OpenThai Quick · Private` has a result. No card carries a may-read-high note.
- **Where the time went.** `agent-browser eval "document.querySelectorAll('#results details summary').forEach(s=>s.click()); JSON.stringify([...document.querySelectorAll('#results table')].map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.textContent).join(' / '))))"`. On 2026-11-25 the private model took 0.91 sec (Find text lines 54%, Read text 39%), and `OpenThai Quick` took 1.33 sec (Find text lines 55%, Read text 42%). The rows add up to `Total` within rounding.
- **All at once.** Open the popover, `agent-browser find role radio click --name "All at once"`, press Escape, and Read. Both cards read `Reading…` together, the private one finishes first, and both carry the may-read-high note. On 2026-11-25 the status was `2 finished · all at once, 1.5 sec in total (the separate times add up to 2.5 sec)`.
- **Side effect.** `.verify/logs/engine.log` gains one `"POST /ocr HTTP/1.1" 200 OK` per server model per read, in either mode.
- **Private model alone.** Untick `OpenThai Quick` in the popover, then Read. One card, and `grep -c 'POST /ocr' .verify/logs/engine.log` is unchanged, which proves the image stayed in the browser.
- **Phone width.** `agent-browser set viewport 390 844`, then `agent-browser eval "document.documentElement.scrollWidth"` returns `390`. Only the text-column region scrolls sideways.
- **Proof.** Save `.verify/evidence/run-ocr/01-page-chosen.png`, `02-results.png`, `agent-browser snapshot > .verify/evidence/run-ocr/02-results.aria.txt`, and the `eval` output.

## Gotchas

- Use forward slashes in the upload path. A backslash path freezes the tab.
- Results clear when a new file is chosen.
- `ocr-api-down` needs the engine API stopped. Don't kill the engine process by name. Run `down`, then `up`, and reproduce by blocking the API URL if needed. Report it unverified if you did not reproduce it.
- Accuracy is `1 − CER`, rounded down to one decimal so a page with mistakes never shows 100%. CER ignores whitespace and Markdown or HTML markup by design; the word diff also strips markup before comparing.
- OpenThai Quick · Private downloads its models from Hugging Face and its WASM runtime from jsDelivr on first use, so the verification browser needs internet. Its time excludes the download.
- Models that share hardware slow each other down when they read together. In this setup the private model and `OpenThai Quick` both use this machine's CPU. Compare times only from `One at a time` reads.
- Without warm-up, reads 1 and 2 come out about 20 to 25% slow. That is why `WARMUP_RUNS` is 2. The practice page is the same synthetic invoice this recipe reads, so a page of a different size can still read slightly slow the first time.
- `#results [role=status]` never holds a ticking clock, because a live region that changes every 100 ms would talk over a screen reader. The ticking seconds live in each card instead.
- Read a state that a click changes, such as the locked `How to run them` group, in a later `eval` than the click. On 2026-11-25 a check in the same `eval` as the Read click saw the group unlocked, probably because React had not re-rendered yet. The lock itself is not yet confirmed in the running app.
