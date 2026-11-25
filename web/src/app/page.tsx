"use client";

import { Check, ChevronDown, FileUp, Info, Loader2, Lock, ScanText, TriangleAlert, X } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { type DragEvent, Fragment, useEffect, useId, useReducer, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type Diff, diffWords, toLines } from "@/lib/diff";
import { explainError, modelInfo } from "@/lib/models";
import { type EngineResult, type EngineStatus, type Stage, listEngines } from "@/lib/ocr-api";
import { BROWSER_ENGINE } from "@/lib/openthai/browser";
import { type Page, createImporter, pagesReducer } from "@/lib/pages";
import { type Readiness, runEngine, warmUp } from "@/lib/run-engine";
import { useSession } from "./providers";

type Done = Extract<EngineResult, { ok: true }>;

/** One at a time gives each model's own time; all at once is faster, but models sharing a computer slow each other. */
type Mode = "queue" | "parallel";

/** One model's part in reading one page. Times are performance.now() values and milliseconds. */
type Slot =
  | { engine: string; status: "waiting" }
  | { engine: string; status: "reading"; startedAt: number }
  | { engine: string; status: "done"; result: Done; ms: number; stages: Stage[]; diff: Diff | null }
  | { engine: string; status: "failed"; error: string };

/** How one page was read. `reference` is the correct text as it was when the read began; `totalMs` is set once every
 * model has answered. */
type Batch = { mode: Mode; reference: string; slots: Slot[]; totalMs: number | null };

/** `started` holds every page this press of Read has begun. `reading` is the one in flight, or null while the next
 * page is still being prepared. */
type Run = { kind: "idle" } | { kind: "running"; started: ReadonlySet<string>; reading: string | null };

/** Places where left and right arrows already do something: typing, the mode choice, the sideways-scrolling text, the
 * models popover. */
const ARROW_KEY_OWNERS = 'input, textarea, select, [contenteditable="true"], [role="radiogroup"], [role="region"], [role="dialog"]';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// A ticking clock can lag a start by one tick, so clamp rather than show -0.0.
const seconds = (ms: number, digits = 1) => (Math.max(0, ms) / 1000).toFixed(digits);

export default function SideBySide() {
  const { email, signOut } = useSession();
  const [engines, setEngines] = useState<EngineStatus[]>([BROWSER_ENGINE]);
  const [serverDown, setServerDown] = useState(false);
  const [readiness, setReadiness] = useState<Record<string, Readiness>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set([BROWSER_ENGINE.name]));
  const [mode, setMode] = useState<Mode>("queue");
  const [pages, dispatch] = useReducer(pagesReducer, []);
  const [importer] = useState(() => createImporter(dispatch));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [batches, setBatches] = useState<ReadonlyMap<string, Batch>>(new Map());
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [notices, setNotices] = useState<string[]>([]);
  const [showCorrect, setShowCorrect] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [showTimes, setShowTimes] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pageList = useRef<HTMLUListElement>(null);
  // The read loop takes the page list from here, and sleeps on `wake` until the list next changes.
  const latestPages = useRef(pages);
  const wake = useRef<() => void>(undefined);

  const page = pages.find((p) => p.id === selectedId) ?? null;
  const batch = page ? batches.get(page.id) : undefined;
  const readable = pages.filter((p) => p.image.kind !== "failed");
  const running = run.kind === "running";
  // Practice pages would slow down a timed read, so Read waits until every model, chosen or not, is ready.
  const preparing = Object.values(readiness).some((r) => r.state === "warming");

  useEffect(() => {
    latestPages.current = pages;
    wake.current?.();
  }, [pages]);

  // As soon as the page opens, every available model loads and reads a practice page, so the first timed read is a
  // steady one. warmUp starts once per model per page load, so React running this effect twice doesn't double it.
  useEffect(() => {
    const prepare = (name: string, runsSoFar: number) => {
      setReadiness((r) => ({ ...r, [name]: { state: "warming" } }));
      void warmUp(name, runsSoFar).then((state) => setReadiness((r) => ({ ...r, [name]: state })));
    };
    prepare(BROWSER_ENGINE.name, 0);
    listEngines()
      .then((list) => {
        setEngines([BROWSER_ENGINE, ...list]);
        setSelected((s) => new Set([...s, ...list.filter((e) => e.available).map((e) => e.name)]));
        for (const e of list) if (e.available) prepare(e.name, e.runs);
      })
      .catch(() => setServerDown(true));
  }, []);

  // A file dropped just outside the drop area would otherwise open in the tab and lose every page.
  useEffect(() => {
    const keep = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => {
      window.removeEventListener("dragover", keep);
      window.removeEventListener("drop", keep);
    };
  }, []);

  // Left and right arrows move to the previous or next page, unless the focused control uses them itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if ((e.target as Element).closest(ARROW_KEY_OWNERS)) return;
      const i = pages.findIndex((p) => p.id === selectedId);
      const next = pages[i + step];
      if (i < 0 || !next) return;
      e.preventDefault();
      setSelectedId(next.id);
      const button = pageList.current?.querySelector<HTMLElement>(`[data-page="${next.id}"]`);
      if (pageList.current?.contains(document.activeElement)) button?.focus();
      else button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages, selectedId]);

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const { firstId, refused } = importer.add(files);
    if (firstId) setSelectedId(firstId);
    setNotices(refused.map((name) => `We couldn't add ${name}. Only photos, scans (PNG or JPG) and PDFs work.`));
  }

  function removePage(target: Page) {
    const i = pages.indexOf(target);
    const neighbour = pages[i + 1] ?? pages[i - 1];
    importer.remove(target.id);
    setBatches((m) => {
      const next = new Map(m);
      next.delete(target.id);
      return next;
    });
    if (target.id === selectedId) setSelectedId(neighbour?.id ?? null);
    // The removed button took focus with it; hand focus to the neighbour so keyboard users keep their place.
    const focusTarget = neighbour && pageList.current?.querySelector<HTMLElement>(`[data-page="${neighbour.id}"]`);
    (focusTarget || fileInput.current)?.focus();
  }

  function removeAll() {
    importer.clear();
    setBatches(new Map());
    setSelectedId(null);
    setNotices([]);
    fileInput.current?.focus();
  }

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  // One request per model, so each card fills in as soon as its model answers. A page removed mid-read loses its
  // Batch, and `patch` then drops whatever its models still send back.
  async function readPage(id: string, file: File, reference: string, order: string[], how: Mode) {
    const patch = (f: (b: Batch) => Batch) =>
      setBatches((m) => {
        const b = m.get(id);
        return b ? new Map(m).set(id, f(b)) : m;
      });
    const settle = (slot: Slot) =>
      patch((b) => ({ ...b, slots: b.slots.map((s) => (s.engine === slot.engine ? slot : s)) }));
    const t0 = performance.now();
    setBatches((m) =>
      new Map(m).set(id, { mode: how, reference, totalMs: null, slots: order.map((engine) => ({ engine, status: "waiting" })) }),
    );

    const one = async (engine: string) => {
      settle({ engine, status: "reading", startedAt: performance.now() });
      const { result, roundTripMs, stages } = await runEngine(engine, file, reference);
      if (!result.ok) return settle({ engine, status: "failed", error: result.error });
      const diff = reference ? diffWords(reference, result.text) : null;
      settle({ engine, status: "done", result, ms: roundTripMs, stages, diff });
    };
    if (how === "parallel") {
      await Promise.all(order.map(one));
    } else {
      for (const engine of order) await one(engine);
    }
    patch((b) => ({ ...b, totalMs: performance.now() - t0 }));
  }

  // Reads pages in list order until none is left, so pages added during the read get read too.
  async function read() {
    if (running || preparing || readable.length === 0 || selected.size === 0) return;
    const order = engines.map((e) => e.name).filter((n) => selected.has(n));
    const how = mode;
    const started = new Set<string>();
    setBatches(new Map());
    // The correct text shows up as its own column in the results, so the box would only push them down.
    setShowCorrect(false);
    try {
      for (;;) {
        const next = latestPages.current.find((p) => !started.has(p.id) && p.image.kind !== "failed");
        if (!next) break;
        if (next.image.kind !== "ready") {
          setRun({ kind: "running", started: new Set(started), reading: null });
          await new Promise<void>((resolve) => (wake.current = resolve));
          continue;
        }
        started.add(next.id);
        setRun({ kind: "running", started: new Set(started), reading: next.id });
        await readPage(next.id, next.image.file, next.groundTruth.trim(), order, how);
      }
    } finally {
      // Whatever happens, a read never leaves the page stuck on "Reading…".
      setRun({ kind: "idle" });
    }
  }

  function readLabel(): string {
    if (run.kind === "idle") {
      if (preparing) return "Getting models ready…";
      const what = readable.length > 1 ? ` ${plural(readable.length, "page")}` : "";
      return `Read${what} with ${plural(selected.size, "model")}`;
    }
    if (readable.length <= 1) return run.reading ? "Reading…" : "Preparing the page…";
    // Finished pages still in the list, plus the one in progress, so removing a page mid-read shrinks both numbers.
    const n = readable.filter((p) => run.started.has(p.id) && p.id !== run.reading).length + 1;
    return `${run.reading ? "Reading" : "Preparing"} page ${n} of ${Math.max(n, readable.length)}…`;
  }

  const slots = batch?.slots ?? [];
  const done = slots.filter((s): s is Extract<Slot, { status: "done" }> => s.status === "done");
  // "Fewest mistakes" only when one model is strictly ahead; a tie has no winner.
  const scores = done.flatMap((r) => (r.result.cer === null ? [] : [{ engine: r.engine, cer: r.result.cer }]));
  const lowest = Math.min(...scores.map((s) => s.cer));
  const leaders = scores.filter((s) => s.cer === lowest);
  const best = scores.length > 1 && leaders.length === 1 ? leaders[0].engine : null;
  const together = batch?.mode === "parallel" && slots.length > 1;
  const reference = batch?.reference ?? "";
  const waitingForEarlier = run.kind === "running" && page !== null && !run.started.has(page.id);
  const showResults = page !== null && (batch !== undefined || waitingForEarlier);
  const hasCorrectText = !!page?.groundTruth.trim();
  const blocker =
    running || preparing
      ? null
      : readable.length === 0
        ? "Add a page to start."
        : selected.size === 0
          ? "Choose at least one model."
          : null;
  // The page gets the widest column: it's the thing every reading is checked against.
  const columns = [
    page?.image.kind === "ready" && "minmax(320px,1.4fr)",
    reference && "minmax(240px,1fr)",
    ...slots.map(() => "minmax(260px,1fr)"),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex min-h-screen flex-col">
      {batch && (
        <a
          href="#results"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
        >
          Skip to results
        </a>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-2 md:px-6">
        <p className="flex items-center gap-2 text-base font-semibold">
          <ScanText aria-hidden className="size-5 text-primary" />
          OCR Playground
        </p>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{email}</span>
          {signOut && (
            <Button variant="link" className="h-9 px-1" onClick={signOut}>
              Sign out
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 px-4 py-6 md:px-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Compare OCR models</h1>
          <p className="text-muted-foreground">
            Add pages, choose the models, and see what each one reads, side by side.
          </p>
        </div>

        {serverDown && (
          <p role="status" className="flex gap-2 rounded-lg border-2 border-dashed border-warning-border bg-warning p-3 text-sm text-warning-foreground">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            We can&apos;t reach the server that runs most models, so only OpenThai2.1-OCR-Text in your browser is available right now.
          </p>
        )}

        <Card className="flex min-w-0 flex-row flex-wrap items-center gap-3 p-4">
          <PageAdder hasPages={pages.length > 0} inputRef={fileInput} onFiles={addFiles} onWarm={importer.warm} />
          <ModelPicker
            engines={engines}
            readiness={readiness}
            selected={selected}
            onToggle={toggle}
          />
          <ModeToggle mode={mode} onMode={setMode} locked={running} />
          <Button
            variant="outline"
            size="lg"
            aria-expanded={showCorrect}
            aria-controls="correct-text"
            onClick={() => setShowCorrect((v) => !v)}
          >
            {hasCorrectText && <Check aria-hidden className="text-success" />}
            {hasCorrectText ? "Correct text added" : "Add the correct text"}
            <ChevronDown
              aria-hidden
              className={`transition-transform motion-reduce:transition-none ${showCorrect ? "rotate-180" : ""}`}
            />
          </Button>
          <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:ml-auto sm:w-auto">
            {blocker && (
              <p id="read-why" className="text-sm text-muted-foreground">
                {blocker}
              </p>
            )}
            <Button
              size="lg"
              className="h-10 w-full px-5 text-base hover:bg-primary-hover sm:w-auto"
              disabled={running || preparing || blocker !== null}
              aria-describedby={preparing ? "getting-ready" : blocker ? "read-why" : undefined}
              onClick={read}
            >
              {readLabel()}
            </Button>
          </div>
          <p id="getting-ready" role="status" className="w-full text-sm text-muted-foreground empty:sr-only">
            {preparing &&
              "Each model reads a practice page first, so the times you see are steady. This takes a few seconds."}
          </p>
          {notices.length > 0 && (
            <ul role="status" className="flex w-full flex-col gap-1 text-sm text-warning-foreground">
              {notices.map((n, i) => (
                <li key={i} className="flex gap-2 rounded-md bg-warning p-2">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {n}
                </li>
              ))}
            </ul>
          )}
          {pages.length > 0 && (
            <PageStrip
              pages={pages}
              selectedId={selectedId}
              listRef={pageList}
              status={(p) => {
                if (run.kind === "running" && run.reading === p.id) return "reading";
                if (batches.get(p.id)?.totalMs != null) return "read";
                return null;
              }}
              onSelect={setSelectedId}
              onRemove={removePage}
              onRemoveAll={removeAll}
            />
          )}
        </Card>

        {showCorrect && (
          <Card id="correct-text" className="gap-2 p-4">
            <label htmlFor="correct-text-input" className="font-medium">
              The correct text
              {page && pages.length > 1 && <> for {page.label}</>}{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <p id="correct-text-help" className="text-sm text-muted-foreground">
              {page
                ? "Paste what the page really says, and we'll count each model's mistakes. Each page has its own."
                : "Add a page first, then paste what it really says."}
            </p>
            <Textarea
              id="correct-text-input"
              lang="th"
              rows={6}
              aria-describedby="correct-text-help"
              value={page?.groundTruth ?? ""}
              disabled={!page || page.image.kind === "failed" || running}
              onChange={(e) => page && dispatch({ type: "groundTruth", id: page.id, text: e.target.value })}
              className="border-input text-base"
            />
          </Card>
        )}

        {showResults && page && (
          <section id="results" aria-labelledby="results-h" aria-busy={running} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="mr-auto">
                <h2 id="results-h" className="text-xl font-semibold text-primary">
                  How each model did
                  {pages.length > 1 && <span className="font-normal text-muted-foreground"> on {page.label}</span>}
                </h2>
                {/* No ticking clock in here: a live region that changes every 100 ms would talk over everything. */}
                <p role="status" className="text-sm text-muted-foreground">
                  {batch ? progressLine(batch, done) : "Waiting for the pages before it."}
                </p>
              </div>
              {batch && reference && (
                <div className="flex flex-col items-start gap-1.5 sm:items-end">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="highlight"
                      checked={highlight}
                      onCheckedChange={setHighlight}
                      className="dark:data-unchecked:bg-input"
                    />
                    <label htmlFor="highlight" className="cursor-pointer text-sm">
                      Highlight mistakes
                    </label>
                  </div>
                  {highlight && (
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span>
                        <Missing>เพิ่ม</Missing> what the page says
                      </span>
                      <span>
                        <Extra>เพิม</Extra> what the model wrote instead
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            {batch && (
              <div
                tabIndex={0}
                role="region"
                aria-label="The page, the correct text, and what each model read. On wide screens with many models, scroll sideways."
                className="overflow-x-auto rounded-xl"
              >
                {/* One column per source. On wider screens every column shares two rows (the scores, then the text),
                    so each model's first line starts level with the others. */}
                <div
                  className="flex flex-col gap-3 md:grid md:grid-flow-col md:grid-rows-[auto_1fr] md:gap-x-3 md:gap-y-0"
                  style={{ gridTemplateColumns: columns }}
                >
                  {page.image.kind === "ready" && (
                    <Column
                      head={
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="font-semibold text-primary">The page</h3>
                          <a
                            href={page.image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-primary underline underline-offset-4 hover:text-primary-hover"
                          >
                            Open full size
                          </a>
                        </div>
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise */}
                      <img src={page.image.url} alt={`The page: ${page.label}`} className="w-full rounded border bg-white" />
                    </Column>
                  )}
                  {reference && (
                    <Column className="bg-muted" head={<h3 className="font-semibold text-primary">The correct text</h3>}>
                      <p lang="th" className="text-[15px] leading-relaxed whitespace-pre-wrap">
                        {reference}
                      </p>
                    </Column>
                  )}
                  {slots.map((slot) => (
                    <Column
                      key={slot.engine}
                      busy={slot.status === "waiting" || slot.status === "reading"}
                      className={slot.engine === best ? "ring-2 ring-success" : ""}
                      head={
                        <ModelHead
                          slot={slot}
                          best={slot.engine === best}
                          together={together}
                          hasReference={!!reference}
                          showTimes={showTimes}
                          onShowTimes={setShowTimes}
                        />
                      }
                    >
                      <ModelText slot={slot} highlight={highlight} />
                    </Column>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

/** The drop area and file picker. Takes many photos, scans and PDFs at once; each PDF page becomes its own page. */
function PageAdder({
  hasPages,
  inputRef,
  onFiles,
  onWarm,
}: {
  hasPages: boolean;
  inputRef: React.Ref<HTMLInputElement>;
  onFiles: (files: File[]) => void;
  onWarm: () => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const onDrag = (e: DragEvent<HTMLElement>, over: boolean) => {
    e.preventDefault();
    // dragleave also fires when moving onto a child of the drop area.
    if (!over && e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(over);
  };
  return (
    <label
      htmlFor={inputId}
      onPointerEnter={onWarm}
      onFocus={onWarm}
      onDragEnter={(e) => {
        onWarm();
        onDrag(e, true);
      }}
      onDragOver={(e) => onDrag(e, true)}
      onDragLeave={(e) => onDrag(e, false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles([...e.dataTransfer.files]);
      }}
      // With no pages yet, adding one is the only thing to do, so the drop area takes the whole first row. It stays the
      // same element as it shrinks, so the file picker keeps focus.
      className={`flex cursor-pointer rounded-lg border-2 border-dashed focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${
        hasPages
          ? "min-h-14 flex-1 basis-72 items-center gap-3 p-2 pr-4"
          : "min-h-56 basis-full flex-col items-center justify-center gap-3 p-6 text-center"
      } ${dragging ? "border-primary bg-accent" : "border-input"}`}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          onFiles(files);
        }}
      />
      <FileUp aria-hidden className={`shrink-0 text-primary ${hasPages ? "size-6" : "size-8"}`} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`font-medium ${hasPages ? "" : "text-lg"}`}>
          {hasPages ? "Drag more pages here, or add files" : "Drag pages here, or choose files"}
        </span>
        <span className="text-sm text-muted-foreground">
          Photos, scans (PNG or JPG) or PDFs. Each PDF page becomes its own page.
        </span>
      </span>
      {!hasPages && (
        // Looks like a button so it's clear the area can be clicked; the label around it does the work.
        <span aria-hidden className="mt-1 rounded-md border border-input px-4 py-2 text-sm font-medium">
          Choose files
        </span>
      )}
    </label>
  );
}

/** The pages added so far, in reading order. Choosing one shows its results; each can be removed at any time. */
function PageStrip({
  pages,
  selectedId,
  listRef,
  status,
  onSelect,
  onRemove,
  onRemoveAll,
}: {
  pages: Page[];
  selectedId: string | null;
  listRef: React.Ref<HTMLUListElement>;
  status: (p: Page) => "reading" | "read" | null;
  onSelect: (id: string) => void;
  onRemove: (p: Page) => void;
  onRemoveAll: () => void;
}) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-primary">{plural(pages.length, "page")}</h2>
        <Button variant="link" className="h-8 px-1 text-sm" onClick={onRemoveAll}>
          Remove all
        </Button>
        {pages.length > 1 && (
          // Phones have no arrow keys, and the hint would squeeze the page count onto two lines.
          <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">
            Press ← or → to go to the previous or next page
          </span>
        )}
      </div>
      <ul ref={listRef} aria-label="Pages" className="flex gap-2 overflow-x-auto pb-1">
        {pages.map((p) => {
          const current = p.id === selectedId;
          const state = status(p);
          return (
            <li
              key={p.id}
              className={`flex w-60 shrink-0 items-stretch rounded-lg border ${
                current ? "border-primary bg-accent" : "border-input"
              }`}
            >
              <button
                type="button"
                data-page={p.id}
                aria-current={current || undefined}
                onClick={() => onSelect(p.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg p-1.5 text-left hover:bg-muted"
              >
                <Thumbnail page={p} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{p.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.image.kind === "preparing" && "Preparing…"}
                    {p.image.kind === "failed" && <span className="text-destructive">{p.image.reason}</span>}
                    {p.image.kind === "ready" && state === "reading" && "Reading…"}
                    {p.image.kind === "ready" && state === "read" && (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check aria-hidden className="size-3" />
                        Read
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${p.label}`}
                onClick={() => onRemove(p)}
                className="grid w-9 shrink-0 place-items-center rounded-r-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Thumbnail({ page }: { page: Page }) {
  if (page.image.kind === "ready") {
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise
    return <img src={page.image.url} alt="" className="h-12 w-10 shrink-0 rounded border bg-white object-cover object-top" />;
  }
  return (
    <span aria-hidden className="grid h-12 w-10 shrink-0 place-items-center rounded border bg-muted text-muted-foreground">
      {page.image.kind === "preparing" ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      ) : (
        <TriangleAlert className="size-4 text-destructive" />
      )}
    </span>
  );
}

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "queue", label: "One at a time", hint: "Each time is accurate, because each model reads alone." },
  {
    value: "parallel",
    label: "All at once",
    hint: "Faster, but times can read high: models on the same computer slow each other down.",
  },
];

function ModelPicker({
  engines,
  readiness,
  selected,
  onToggle,
}: {
  engines: EngineStatus[];
  readiness: Record<string, Readiness>;
  selected: ReadonlySet<string>;
  onToggle: (name: string) => void;
}) {
  function about(e: EngineStatus, goodFor: string): string {
    if (!e.available) return "Not set up on this server yet.";
    const r = readiness[e.name];
    if (r?.state === "warming") return "Getting ready: reading a practice page…";
    if (r?.state === "failed") return `Couldn't get ready. ${explainError(e.name, r.error)}`;
    return goodFor;
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="lg">
          {plural(selected.size, "model")}
          <ChevronDown aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-2 p-2">
        <fieldset className="flex flex-col gap-1">
          <legend className="px-2 py-1 text-sm font-semibold">Models to compare</legend>
          {engines.map((e) => {
            const info = modelInfo(e.name);
            const id = `model-${e.name}`;
            return (
              <div key={e.name} className={`flex gap-3 rounded-md p-2 ${e.available ? "hover:bg-muted" : ""}`}>
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  disabled={!e.available}
                  checked={selected.has(e.name)}
                  onCheckedChange={() => onToggle(e.name)}
                  aria-describedby={`${id}-about`}
                />
                <label htmlFor={id} className={e.available ? "cursor-pointer" : "cursor-not-allowed"}>
                  <span className="block font-medium">{info.name}</span>
                  <span id={`${id}-about`} aria-live="polite" className="block text-sm text-muted-foreground">
                    {about(e, info.goodFor)}
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

/** Two choices side by side. Each one's hint shows on hover and is read out as its description. */
function ModeToggle({ mode, onMode, locked }: { mode: Mode; onMode: (m: Mode) => void; locked: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span id="mode-label" className="text-sm font-medium">
        How to run
      </span>
      <RadioGroup.Root
        aria-labelledby="mode-label"
        value={mode}
        onValueChange={(v) => onMode(v as Mode)}
        disabled={locked}
        orientation="horizontal"
        className="flex rounded-lg border border-input p-0.5 data-disabled:opacity-60"
      >
        {MODES.map((m) => (
          <RadioGroup.Item
            key={m.value}
            value={m.value}
            title={m.hint}
            className="h-9 rounded-md px-3 text-sm font-medium text-muted-foreground outline-ring not-aria-checked:hover:bg-muted not-aria-checked:hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed aria-checked:bg-accent aria-checked:text-foreground aria-checked:ring-1 aria-checked:ring-primary"
          >
            {m.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}

function accuracy(cer: number): string {
  if (cer <= 0) return "100%";
  // round down, so a page with mistakes never shows 100%
  return `${Math.max(0, Math.floor((1 - cer) * 1000) / 10).toFixed(1)}%`;
}

/** The finished summary: how long the whole read took, and for all at once, what the separate times add up to. */
function totalLine(batch: Batch, done: Extract<Slot, { status: "done" }>[]): string {
  const total = `${seconds(batch.totalMs ?? 0)} sec in total`;
  if (batch.mode === "queue" || batch.slots.length < 2) return `One at a time, ${total}.`;
  const added = done.reduce((sum, d) => sum + d.ms, 0);
  return `All at once, ${total} (the separate times add up to ${seconds(added)} sec).`;
}

/** Where the read of one page stands, as sentences: "2 finished, 1 reading." then the total once all have answered. */
function progressLine(batch: Batch, done: Extract<Slot, { status: "done" }>[]): string {
  const count = (status: Slot["status"]) => batch.slots.filter((s) => s.status === status).length;
  const [finished, reading, waiting, failed] = [count("done"), count("reading"), count("waiting"), count("failed")];
  const parts = [
    finished && `${finished} finished`,
    reading && `${reading} reading`,
    waiting && `${waiting} waiting ${waiting === 1 ? "its" : "their"} turn`,
    failed && `${failed} need${failed === 1 ? "s" : ""} another try`,
  ].filter(Boolean);
  const now = `${parts.join(", ")}.`;
  return batch.totalMs === null ? now : `${now} ${totalLine(batch, done)}`;
}

/** Seconds since `since`, ticking. Its own component, so the tick re-renders this text and not the whole page. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular-nums">{seconds(now - since)} sec</span>;
}

/** Each step of one read, in order and without overlap, so the rows add up to the total. Every card opens and closes
 * together, so the steps can be compared across models. */
function TimeBreakdown({
  stages,
  total,
  open,
  onOpen,
}: {
  stages: Stage[];
  total: number;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const share = (ms: number) => (total > 0 ? (100 * ms) / total : 0);
  return (
    <details className="text-sm" open={open} onToggle={(e) => onOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-muted-foreground">Where the time went</summary>
      <table className="mt-2 w-full tabular-nums">
        <tbody>
          {stages.map((s) => (
            <tr key={s.name}>
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {s.name}
                <span aria-hidden className="mt-1 block h-1 rounded bg-muted">
                  <span className="block h-full rounded bg-primary" style={{ width: `${share(s.ms)}%` }} />
                </span>
              </th>
              <td className="py-1 text-right whitespace-nowrap">{seconds(s.ms, 2)} sec</td>
              <td className="py-1 pl-2 text-right text-muted-foreground">{Math.round(share(s.ms))}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t">
          <tr>
            <th scope="row" className="pt-1 text-left font-medium">
              Total
            </th>
            <td className="pt-1 text-right font-medium whitespace-nowrap">{seconds(total, 2)} sec</td>
            <td className="pt-1 pl-2 text-right text-muted-foreground">100%</td>
          </tr>
        </tfoot>
      </table>
    </details>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-1.5 text-sm text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

/** One column of the results: a head (scores) and a body (text). From md up the two parts sit on rows shared by every
 * column, so the bodies line up. */
function Column({
  head,
  children,
  busy,
  className = "",
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  busy?: boolean;
  className?: string;
}) {
  return (
    <Card aria-busy={busy || undefined} className={`gap-0 py-0 md:row-span-2 md:grid md:grid-rows-subgrid ${className}`}>
      <div className="flex flex-col gap-2 p-4">{head}</div>
      <div className="border-t p-4">{children}</div>
    </Card>
  );
}

/** A model's name and how it did. Mistakes lead: "2 mistakes" says more to most people than "99.0%". */
function ModelHead({
  slot: run,
  best,
  together,
  hasReference,
  showTimes,
  onShowTimes,
}: {
  slot: Slot;
  best: boolean;
  together: boolean;
  hasReference: boolean;
  showTimes: boolean;
  onShowTimes: (open: boolean) => void;
}) {
  const info = modelInfo(run.engine);
  const title = (
    <div className="flex flex-wrap items-center gap-1.5">
      <h3 className="mr-auto font-semibold wrap-anywhere text-primary">{info.name}</h3>
      {best && <Badge className="bg-success-muted text-success-muted-foreground">Fewest mistakes</Badge>}
      {info.badge && (
        <Badge variant="outline" className="gap-1">
          {info.private && <Lock aria-hidden className="size-3" />}
          {info.badge}
        </Badge>
      )}
    </div>
  );

  if (run.status === "waiting" || run.status === "reading") {
    return (
      <>
        {title}
        <p className="text-sm text-muted-foreground">{info.goodFor}</p>
        {run.status === "waiting" ? (
          <p className="font-medium text-muted-foreground">Waiting for its turn</p>
        ) : (
          <p className="font-medium">
            Reading… <Elapsed since={run.startedAt} />
          </p>
        )}
      </>
    );
  }

  if (run.status === "failed") {
    return (
      <>
        {title}
        <p role="alert" className="flex gap-2 rounded-md border border-dashed border-warning-border bg-warning p-2.5 text-sm text-warning-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {explainError(run.engine, run.error)}
        </p>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 font-mono text-xs break-all">{run.error}</p>
        </details>
      </>
    );
  }

  const { result, diff } = run;
  const took = `${seconds(run.ms)} sec`;
  let headline: string;
  let detail: string;
  if (result.cer !== null && diff) {
    headline = diff.mistakes === 0 ? "No mistakes" : plural(diff.mistakes, "mistake");
    detail = `${accuracy(result.cer)} accurate, took ${took}`;
  } else if (result.cer !== null) {
    headline = `${accuracy(result.cer)} accurate`;
    detail = `Took ${took}. The text is too long to mark each mistake.`;
  } else {
    headline = took;
    detail = hasReference ? "" : "Add the correct text to count mistakes.";
  }
  return (
    <>
      {title}
      <div>
        <p className="text-2xl leading-tight font-semibold tabular-nums">{headline}</p>
        {detail && <p className="text-sm text-muted-foreground tabular-nums">{detail}</p>}
      </div>
      {result.cold && <Note>The time may read high: the model was still warming up.</Note>}
      {together && <Note>The time may read high: other models were reading at the same time.</Note>}
      <TimeBreakdown stages={run.stages} total={run.ms} open={showTimes} onOpen={onShowTimes} />
    </>
  );
}

function ModelText({ slot: run, highlight }: { slot: Slot; highlight: boolean }) {
  return (
    <>
      {(run.status === "reading" || run.status === "waiting") && (
        <div aria-hidden className={`flex flex-col gap-3 pt-1 ${run.status === "waiting" ? "opacity-40" : ""}`}>
          {[80, 60, 90, 70, 55].map((w) => (
            <div
              key={w}
              className={`h-3.5 rounded bg-muted ${run.status === "reading" ? "animate-pulse motion-reduce:animate-none" : ""}`}
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      )}
      {run.status === "failed" && <p className="text-sm text-muted-foreground">No text from this model.</p>}
      {run.status === "done" && (
        <p lang="th" className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {toLines(run.result.text, highlight ? run.diff?.segments : undefined).map((line, i) => (
            <Fragment key={i}>
              {i > 0 && "\n"}
              <span className={line.heading ? "text-base font-semibold text-primary" : undefined}>
                {line.segments.map((s, k) =>
                  s.kind === "same" ? (
                    <span key={k}>{s.text}</span>
                  ) : s.kind === "missing" ? (
                    <Missing key={k}>{s.text}</Missing>
                  ) : (
                    <Extra key={k}>{s.text}</Extra>
                  ),
                )}
              </span>
            </Fragment>
          ))}
        </p>
      )}
    </>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <del className="mr-0.5 rounded bg-diff-page px-0.5 text-diff-page-foreground decoration-2">
      <span className="sr-only">page says </span>
      {children}
    </del>
  );
}

function Extra({ children }: { children: React.ReactNode }) {
  return (
    <ins className="rounded bg-diff-model px-0.5 text-diff-model-foreground underline decoration-2 underline-offset-4">
      <span className="sr-only">model wrote </span>
      {children}
    </ins>
  );
}
