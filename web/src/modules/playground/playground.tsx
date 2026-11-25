"use client";

import { Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/modules/auth";
import { type Page, createImporter, pagesReducer } from "@/modules/documents";
import { BROWSER_ENGINE, type EngineStatus, type Readiness, listEngines, runEngine, warmUp } from "@/modules/engines";
import { diffWords } from "@/modules/scoring";

import { type Batch, type Mode, type Run, type Slot, bestEngine, progressLine, readLabel } from "./core/run";
import { Extra, Missing } from "./ui/marks";
import { ModelPicker } from "./ui/model-picker";
import { PageAdder } from "./ui/page-adder";
import { PageStrip } from "./ui/page-strip";
import { ScoreCard } from "./ui/score-card";
import { TextColumn } from "./ui/text-column";

export function Playground() {
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

  const slots = batch?.slots ?? [];
  const best = bestEngine(slots);
  const together = batch?.mode === "parallel" && slots.length > 1;
  const reference = batch?.reference ?? "";
  const waitingForEarlier = run.kind === "running" && page !== null && !run.started.has(page.id);
  const showResults = page !== null && (batch !== undefined || waitingForEarlier);

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
          <Sparkles aria-hidden className="size-5 text-primary" />
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
          <h1 className="text-2xl font-semibold">Compare OCR models</h1>
          <p className="text-muted-foreground">
            Add pages, choose the models, and see what each one reads, side by side.
          </p>
        </div>

        {serverDown && (
          <p role="status" className="flex gap-2 rounded-lg border-2 border-dashed border-warning-border bg-warning p-3 text-sm text-warning-foreground">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            We can&apos;t reach the server that runs most models, so only OpenThai Quick · Private is available right now.
          </p>
        )}

        <Card className="flex min-w-0 flex-row flex-wrap items-center gap-4 p-4">
          <PageAdder hasPages={pages.length > 0} inputRef={fileInput} onFiles={addFiles} onWarm={importer.warm} />
          <ModelPicker
            engines={engines}
            readiness={readiness}
            selected={selected}
            onToggle={toggle}
            mode={mode}
            onMode={setMode}
            locked={running}
          />
          <Button
            variant="outline"
            size="lg"
            aria-expanded={showCorrect}
            aria-controls="correct-text"
            onClick={() => setShowCorrect((v) => !v)}
          >
            {page?.groundTruth.trim() ? "Correct text added" : "Add the correct text"}
          </Button>
          <Button
            size="lg"
            className="ml-auto h-10 px-5 text-base hover:bg-primary-hover"
            disabled={running || preparing || readable.length === 0 || selected.size === 0}
            aria-describedby={preparing ? "getting-ready" : undefined}
            onClick={read}
          >
            {readLabel(run, readable, selected.size, preparing)}
          </Button>
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
          <section id="results" aria-labelledby="results-h" aria-busy={running} className="flex flex-col gap-5">
            <div>
              <h2 id="results-h" className="text-xl font-semibold">
                How each model did
                {pages.length > 1 && <span className="font-normal text-muted-foreground"> on {page.label}</span>}
              </h2>
              {/* No ticking clock in here: a live region that changes every 100 ms would talk over everything. */}
              <p role="status" className="text-sm text-muted-foreground">
                {batch
                  ? progressLine(batch)
                  : "Waiting for the pages before it."}
              </p>
            </div>

            {batch && (
              <>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
                  {slots.map((slot) => (
                    <ScoreCard
                      key={slot.engine}
                      slot={slot}
                      best={slot.engine === best}
                      together={together}
                      hasReference={!!reference}
                    />
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <h2 className="mr-auto text-xl font-semibold">The text</h2>
                  {reference && (
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
                  )}
                </div>
                {highlight && reference && (
                  <p className="-mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      <Missing>เพิ่ม</Missing> what the page says
                    </span>
                    <span>
                      <Extra>เพิม</Extra> what the model wrote instead
                    </span>
                  </p>
                )}

                <div
                  tabIndex={0}
                  role="region"
                  aria-label="The page and the text from each model. On small screens, scroll sideways."
                  className="relative overflow-x-auto rounded-xl"
                >
                  <div className="grid auto-cols-[minmax(280px,1fr)] grid-flow-col gap-3">
                    {page.image.kind === "ready" && (
                      <Card className="gap-2 p-4">
                        <h3 className="font-semibold">The page</h3>
                        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise */}
                        <img
                          src={page.image.url}
                          alt={`The page: ${page.label}`}
                          className="w-full rounded border bg-white"
                        />
                      </Card>
                    )}
                    {reference && (
                      <Card className="gap-2 bg-muted p-4">
                        <h3 className="font-semibold">The correct text</h3>
                        <p lang="th" className="text-[15px] leading-relaxed whitespace-pre-wrap">
                          {reference}
                        </p>
                      </Card>
                    )}
                    {slots.map((slot) => (
                      <TextColumn key={slot.engine} slot={slot} highlight={highlight} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
