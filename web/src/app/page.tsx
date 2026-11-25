"use client";

import { ChevronDown, FileUp, Info, Lock, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type Diff, diffWords, toPlainText } from "@/lib/diff";
import { explainError, modelInfo } from "@/lib/models";
import { type EngineResult, type EngineStatus, type Stage, listEngines } from "@/lib/ocr-api";
import { BROWSER_ENGINE } from "@/lib/openthai/browser";
import { type Readiness, runEngine, warmUp } from "@/lib/run-engine";
import { useSession } from "./providers";

type Done = Extract<EngineResult, { ok: true }>;

/** One at a time gives each model's own time; all at once is faster, but models sharing a computer slow each other. */
type Mode = "queue" | "parallel";

/** One model's part in the current run. Times are performance.now() values and milliseconds. */
type Slot =
  | { engine: string; status: "waiting" }
  | { engine: string; status: "reading"; startedAt: number }
  | { engine: string; status: "done"; result: Done; ms: number; stages: Stage[]; diff: Diff | null }
  | { engine: string; status: "failed"; error: string };

/** One press of Read. `totalMs` is set once every model has answered. */
type Batch = { mode: Mode; slots: Slot[]; totalMs: number | null };

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
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [correctText, setCorrectText] = useState("");
  const [showCorrect, setShowCorrect] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [running, setRunning] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const runId = useRef(0);

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

  function chooseFile(next: File | null) {
    if (!next) return;
    setFile(next);
    runId.current += 1; // results still coming for the old page are dropped
    setBatch(null);
    setRunning(false);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(next);
    });
  }

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  // Practice pages would slow down a timed read, so Read waits until every model, chosen or not, is ready.
  const preparing = Object.values(readiness).some((r) => r.state === "warming");

  // One request per model, so each card fills in as soon as its model answers. A card's time runs from sending the
  // request to getting the result back.
  async function read() {
    if (!file || selected.size === 0 || running || preparing) return;
    const id = ++runId.current;
    const live = () => runId.current === id;
    const reference = correctText.trim();
    const order = engines.map((e) => e.name).filter((n) => selected.has(n));
    const t0 = performance.now();
    setBatch({ mode, totalMs: null, slots: order.map((engine) => ({ engine, status: "waiting" })) });
    setRunning(true);
    const settle = (slot: Slot) => {
      if (!live()) return;
      setBatch((b) => b && { ...b, slots: b.slots.map((s) => (s.engine === slot.engine ? slot : s)) });
    };

    const one = async (engine: string) => {
      settle({ engine, status: "reading", startedAt: performance.now() });
      const { result, roundTripMs, stages } = await runEngine(engine, file, reference);
      if (!result.ok) return settle({ engine, status: "failed", error: result.error });
      const diff = reference ? diffWords(reference, result.text) : null;
      settle({ engine, status: "done", result, ms: roundTripMs, stages, diff });
    };
    try {
      if (mode === "parallel") {
        await Promise.all(order.map(one));
      } else {
        for (const engine of order) {
          if (!live()) return;
          await one(engine);
        }
      }
      if (live()) setBatch((b) => b && { ...b, totalMs: performance.now() - t0 });
    } finally {
      // Whatever happens, a read never leaves the page stuck on "Reading…".
      if (live()) setRunning(false);
    }
  }

  const slots = batch?.slots ?? [];
  const done = slots.filter((s): s is Extract<Slot, { status: "done" }> => s.status === "done");
  // "Fewest mistakes" only when one model is strictly ahead; a tie has no winner.
  const scores = done.flatMap((r) => (r.result.cer === null ? [] : [{ engine: r.engine, cer: r.result.cer }]));
  const lowest = Math.min(...scores.map((s) => s.cer));
  const leaders = scores.filter((s) => s.cer === lowest);
  const best = scores.length > 1 && leaders.length === 1 ? leaders[0].engine : null;
  const count = (status: Slot["status"]) => slots.filter((s) => s.status === status).length;
  const together = batch?.mode === "parallel" && slots.length > 1;

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
            Add one page, choose the models, and see what each one reads, side by side.
          </p>
        </div>

        {serverDown && (
          <p role="status" className="flex gap-2 rounded-lg border-2 border-dashed border-warning-border bg-warning p-3 text-sm text-warning-foreground">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            We can&apos;t reach the server that runs most models, so only OpenThai Quick · Private is available right now.
          </p>
        )}

        <Card className="flex flex-row flex-wrap items-center gap-4 p-4">
          <DocumentPicker file={file} preview={preview} onChoose={chooseFile} />
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
            {correctText.trim() ? "Correct text added" : "Add the correct text"}
          </Button>
          <Button
            size="lg"
            className="ml-auto h-10 px-5 text-base hover:bg-primary-hover"
            disabled={!file || selected.size === 0 || running || preparing}
            aria-describedby={preparing ? "getting-ready" : undefined}
            onClick={read}
          >
            {running ? "Reading…" : preparing ? "Getting models ready…" : `Read with ${plural(selected.size, "model")}`}
          </Button>
          <p id="getting-ready" role="status" className="w-full text-sm text-muted-foreground empty:sr-only">
            {preparing &&
              "Each model reads a practice page first, so the times you see are steady. This takes a few seconds."}
          </p>
        </Card>

        {showCorrect && (
          <Card id="correct-text" className="gap-2 p-4">
            <label htmlFor="correct-text-input" className="font-medium">
              The correct text <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <p id="correct-text-help" className="text-sm text-muted-foreground">
              Paste what the page really says, and we&apos;ll count each model&apos;s mistakes.
            </p>
            <Textarea
              id="correct-text-input"
              lang="th"
              rows={6}
              aria-describedby="correct-text-help"
              value={correctText}
              onChange={(e) => setCorrectText(e.target.value)}
              className="border-input text-base"
            />
          </Card>
        )}

        {batch && (
          <section id="results" aria-labelledby="results-h" aria-busy={running} className="flex flex-col gap-5">
            <div>
              <h2 id="results-h" className="text-xl font-semibold">
                How each model did
              </h2>
              {/* No ticking clock in here: a live region that changes every 100 ms would talk over everything. */}
              <p role="status" className="text-sm text-muted-foreground">
                {[
                  count("done") && `${count("done")} finished`,
                  count("reading") && `${count("reading")} reading`,
                  count("waiting") && `${count("waiting")} waiting ${count("waiting") === 1 ? "its" : "their"} turn`,
                  count("failed") && `${count("failed")} need${count("failed") === 1 ? "s" : ""} another try`,
                  batch.totalMs !== null && totalLine(batch, done),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
              {slots.map((slot) => (
                <ScoreCard
                  key={slot.engine}
                  slot={slot}
                  best={slot.engine === best}
                  together={together}
                  hasReference={!!correctText.trim()}
                />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <h2 className="mr-auto text-xl font-semibold">The text</h2>
              {correctText.trim() && (
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
            {highlight && correctText.trim() && (
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
              aria-label="Text from each model. On small screens, scroll sideways."
              className="relative overflow-x-auto rounded-xl"
            >
              <div className="grid auto-cols-[minmax(280px,1fr)] grid-flow-col gap-3">
                {correctText.trim() && (
                  <Card className="gap-2 bg-muted p-4">
                    <h3 className="font-semibold">The correct text</h3>
                    <p lang="th" className="text-[15px] leading-relaxed whitespace-pre-wrap">
                      {correctText.trim()}
                    </p>
                  </Card>
                )}
                {slots.map((slot) => (
                  <TextColumn key={slot.engine} slot={slot} highlight={highlight} />
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function DocumentPicker({
  file,
  preview,
  onChoose,
}: {
  file: File | null;
  preview: string | null;
  onChoose: (f: File | null) => void;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  return (
    <label
      htmlFor={inputId}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onChoose(e.dataTransfer.files[0] ?? null);
      }}
      className={`flex min-h-14 flex-1 basis-72 cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-2 pr-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${
        dragging ? "border-primary bg-accent" : "border-input"
      }`}
    >
      <input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        onChange={(e) => onChoose(e.target.files?.[0] ?? null)}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise
        <img src={preview} alt="" className="h-12 w-20 rounded border object-cover" />
      ) : (
        <FileUp aria-hidden className="size-6 text-primary" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{file ? file.name : "Drag a page here, or choose a file"}</span>
        <span className="text-sm text-muted-foreground">
          {file ? (
            <>
              <span className="text-primary underline underline-offset-4">Change document</span>
            </>
          ) : (
            "Photo or scan, PNG or JPG, one page"
          )}
        </span>
      </span>
    </label>
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
  mode,
  onMode,
  locked,
}: {
  engines: EngineStatus[];
  readiness: Record<string, Readiness>;
  selected: ReadonlySet<string>;
  onToggle: (name: string) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  locked: boolean;
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
        <fieldset disabled={locked} className="flex flex-col gap-1 border-t pt-2 disabled:opacity-60">
          <legend className="px-2 py-1 text-sm font-semibold">How to run them</legend>
          <RadioGroup value={mode} onValueChange={(v) => onMode(v as Mode)} disabled={locked} className="gap-1">
            {MODES.map((m) => (
              <div key={m.value} className="flex gap-3 rounded-md p-2 hover:bg-muted">
                <RadioGroupItem
                  id={`mode-${m.value}`}
                  value={m.value}
                  className="mt-0.5 border-input"
                  aria-describedby={`mode-${m.value}-about`}
                />
                <label htmlFor={`mode-${m.value}`} className="cursor-pointer">
                  <span className="block font-medium">{m.label}</span>
                  <span id={`mode-${m.value}-about`} className="block text-sm text-muted-foreground">
                    {m.hint}
                  </span>
                </label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      </PopoverContent>
    </Popover>
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
  if (batch.mode === "queue" || batch.slots.length < 2) return `one at a time, ${total}`;
  const added = done.reduce((sum, d) => sum + d.ms, 0);
  return `all at once, ${total} (the separate times add up to ${seconds(added)} sec)`;
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

/** Collapsed by default: each step of one read, in order and without overlap, so the rows add up to the total. */
function TimeBreakdown({ stages, total }: { stages: Stage[]; total: number }) {
  const share = (ms: number) => (total > 0 ? (100 * ms) / total : 0);
  return (
    <details className="text-sm">
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

function ScoreCard({
  slot: run,
  best,
  together,
  hasReference,
}: {
  slot: Slot;
  best: boolean;
  together: boolean;
  hasReference: boolean;
}) {
  const info = modelInfo(run.engine);
  const header = (
    <div className="flex flex-wrap items-center gap-1.5">
      <h3 className="mr-auto font-semibold">{info.name}</h3>
      {best && (
        <Badge className="bg-success-muted text-success-muted-foreground">Fewest mistakes</Badge>
      )}
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
      <Card aria-busy className="gap-2 p-4">
        {header}
        <p className="text-sm text-muted-foreground">{info.goodFor}</p>
        {run.status === "waiting" ? (
          <p className="font-medium text-muted-foreground">Waiting for its turn</p>
        ) : (
          <>
            <p className="font-medium">
              Reading… <Elapsed since={run.startedAt} />
            </p>
            <div aria-hidden className="h-2 overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded bg-primary motion-reduce:animate-none" />
            </div>
          </>
        )}
      </Card>
    );
  }

  if (run.status === "failed") {
    return (
      <Card className="gap-2 border-2 border-dashed border-warning-border p-4">
        {header}
        <p role="alert" className="flex gap-2 rounded-md bg-warning p-2.5 text-sm text-warning-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {explainError(run.engine, run.error)}
        </p>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 font-mono text-xs break-all">{run.error}</p>
        </details>
      </Card>
    );
  }

  const { result, diff } = run;
  const took = seconds(run.ms);
  const notes = (
    <>
      {result.cold && <Note>The time may read high: the model was still warming up.</Note>}
      {together && <Note>The time may read high: other models were reading at the same time.</Note>}
      <TimeBreakdown stages={run.stages} total={run.ms} />
    </>
  );
  return (
    <Card className={`gap-2 p-4 ${best ? "border-2 border-success" : ""}`}>
      {header}
      <p className="text-sm text-muted-foreground">{info.goodFor}</p>
      {result.cer !== null ? (
        <>
          <p className="text-3xl leading-tight font-bold">
            {accuracy(result.cer)}
            <span className="text-sm font-medium text-muted-foreground"> accurate</span>
          </p>
          <div aria-hidden className="h-2 overflow-hidden rounded bg-muted">
            <div
              className={`h-full rounded ${best ? "bg-success" : "bg-primary"}`}
              style={{ width: `${Math.max(0, 1 - result.cer) * 100}%` }}
            />
          </div>
          <p className="text-sm">
            {diff
              ? diff.mistakes === 0
                ? "No mistakes"
                : `${diff.mistakes} mistake${diff.mistakes === 1 ? "" : "s"}`
              : "Too long to list mistakes"}{" "}
            · took {took} sec
          </p>
        </>
      ) : (
        <p className="text-sm">
          Took {took} sec.{" "}
          {!hasReference && <span className="text-muted-foreground">Add the correct text to see accuracy.</span>}
        </p>
      )}
      {notes}
    </Card>
  );
}

function TextColumn({ slot: run, highlight }: { slot: Slot; highlight: boolean }) {
  const info = modelInfo(run.engine);
  return (
    <Card className="gap-2 p-4">
      <h3 className="font-semibold">
        {info.name}
        {run.status === "done" && run.diff && (
          <span className="text-sm font-normal text-muted-foreground">
            {" "}
            · {run.diff.mistakes} mistake{run.diff.mistakes === 1 ? "" : "s"}
          </span>
        )}
      </h3>
      {run.status === "reading" && (
        <div aria-hidden className="flex flex-col gap-3 pt-1">
          {[80, 60, 90, 70, 55].map((w) => (
            <div key={w} className="h-3.5 animate-pulse rounded bg-muted motion-reduce:animate-none" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      {run.status === "waiting" && <p className="text-sm text-muted-foreground">Waiting for its turn.</p>}
      {run.status === "failed" && <p className="text-sm text-muted-foreground">No text. See the card above.</p>}
      {run.status === "done" && (
        <p lang="th" className="text-[15px] leading-relaxed whitespace-pre-wrap">
          {highlight && run.diff
            ? run.diff.segments.map((s, i) =>
                s.kind === "same" ? (
                  <span key={i}>{s.text}</span>
                ) : s.kind === "missing" ? (
                  <Missing key={i}>{s.text}</Missing>
                ) : (
                  <Extra key={i}>{s.text}</Extra>
                ),
              )
            : toPlainText(run.result.text)}
        </p>
      )}
    </Card>
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
