"use client";

import { type DragEvent, useEffect, useReducer, useRef, useState } from "react";
import { type EngineStatus, OCR_API_URL, type Stage, listEngines } from "@/lib/ocr-api";
import { BROWSER_ENGINE } from "@/lib/openthai/browser";
import { type Page, createImporter, pagesReducer } from "@/lib/pages";
import { type Readiness, type Timed, runEngine, warmUp } from "@/lib/run-engine";
import styles from "./page.module.css";
import { useSession } from "./providers";

type Mode = "queue" | "parallel";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "queue", label: "One at a time", hint: "Each engine runs alone, so its time is accurate." },
  {
    value: "parallel",
    label: "All at once",
    hint: "Faster. Engines that share a computer slow each other down, so times can read high.",
  },
];

/** How one page was read: the mode, which engines in card order, when each started (performance.now()), and what
 * each returned. `wallMs` is set once every engine has answered. */
type PageRun = {
  mode: Mode;
  names: string[];
  t0: number;
  startedAt: Record<string, number>;
  results: Record<string, Timed>;
  wallMs: number | null;
};

/** `started` holds every page this press of Run has begun reading. `reading` is the one in flight, or null while the
 * next page is still preparing. */
type Run = { kind: "idle" } | { kind: "running"; started: ReadonlySet<string>; reading: string | null };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The ticking clock can lag an engine's start by one tick, so clamp rather than show -0.0 s.
const seconds = (ms: number, digits = 1) => (Math.max(0, ms) / 1000).toFixed(digits);

/** A collapsed Breakdown: each stage of one run as a row, with its time and its share of the request-to-result time. */
function StageBreakdown({ stages, total }: { stages: Stage[]; total: number }) {
  const share = (ms: number) => (total > 0 ? (100 * ms) / total : 0);
  return (
    <details className={styles.breakdown}>
      <summary>Breakdown · {seconds(total, 2)} s</summary>
      <table className={styles.stages}>
        <tbody>
          {stages.map((s) => (
            <tr key={s.name}>
              <th scope="row">{s.name}</th>
              <td className={styles.bar} aria-hidden="true">
                <span style={{ width: `${share(s.ms)}%` }} />
              </td>
              <td>{seconds(s.ms, 2)} s</td>
              <td>{Math.round(share(s.ms))}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Request to result</th>
            <td />
            <td>{seconds(total, 2)} s</td>
            <td>100%</td>
          </tr>
        </tfoot>
      </table>
    </details>
  );
}

export default function Playground() {
  const { email, signOut } = useSession();
  const [engines, setEngines] = useState<EngineStatus[] | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<Record<string, Readiness>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set([BROWSER_ENGINE.name]));
  const [pages, dispatch] = useReducer(pagesReducer, []);
  const [importer] = useState(() => createImporter(dispatch));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("queue");
  const [runs, setRuns] = useState<ReadonlyMap<string, PageRun>>(new Map());
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [now, setNow] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pageList = useRef<HTMLUListElement>(null);
  // The run loop reads the page list from here, and sleeps on `wake` until the list next changes.
  const latestPages = useRef(pages);
  const wake = useRef<() => void>(undefined);

  const page = pages.find((p) => p.id === selectedId) ?? null;
  const pageRun = page ? runs.get(page.id) : undefined;
  const readable = pages.filter((p) => p.image.kind !== "failed");
  const running = run.kind === "running";
  // Practice pages would slow down a timed run, so Run waits until every engine, selected or not, is done warming up.
  const warmingUp = Object.values(readiness).some((r) => r.state === "warming");

  useEffect(() => {
    latestPages.current = pages;
    wake.current?.();
  }, [pages]);

  // As soon as the page opens, every available engine downloads or loads its model and reads a practice page until it
  // is past warm-up, so the first timed run is already a steady one.
  useEffect(() => {
    const prepare = (name: string, runsSoFar: number) => {
      setReadiness((r) => ({ ...r, [name]: { state: "warming" } }));
      void warmUp(name, runsSoFar).then((state) => setReadiness((r) => ({ ...r, [name]: state })));
    };
    prepare(BROWSER_ENGINE.name, 0);
    listEngines()
      .then((list) => {
        setEngines(list);
        setSelected((s) => new Set([...s, ...list.filter((e) => e.available).map((e) => e.name)]));
        for (const e of list) if (e.available) prepare(e.name, e.runs);
      })
      .catch(() =>
        setApiError(
          `Can't reach the engine API at ${OCR_API_URL}, so only the in-browser engine is listed. Start the API with \`uv run ocr serve\` in engines/.`,
        ),
      );
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [running]);

  // A file dropped just outside the drop zone would otherwise open in the tab and lose every page.
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
    setNotices(refused.map((name) => `Couldn't add ${name} — only images and PDFs work.`));
  }

  function onDrag(e: DragEvent<HTMLElement>, over: boolean) {
    e.preventDefault();
    // dragleave also fires when moving onto a child of the drop zone.
    if (!over && e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(over);
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    addFiles([...e.dataTransfer.files]);
  }

  function removePage(target: Page) {
    const i = pages.indexOf(target);
    const neighbour = pages[i + 1] ?? pages[i - 1];
    importer.remove(target.id);
    setRuns((r) => {
      const next = new Map(r);
      next.delete(target.id);
      return next;
    });
    if (target.id === selectedId) setSelectedId(neighbour?.id ?? null);
    // The removed × button took focus with it; hand focus to the neighbour so keyboard users keep their place.
    const focusTarget = neighbour && pageList.current?.querySelector<HTMLElement>(`[data-page="${neighbour.id}"]`);
    (focusTarget || fileInput.current)?.focus();
  }

  function removeAll() {
    importer.clear();
    setRuns(new Map());
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

  // One request per engine, so each card fills in as soon as its engine answers. A page removed mid-read loses its
  // PageRun, and `patch` then drops whatever its engines still send back.
  async function readPage(id: string, file: File, groundTruth: string, names: string[], how: Mode) {
    const patch = (f: (r: PageRun) => PageRun) =>
      setRuns((m) => {
        const r = m.get(id);
        return r ? new Map(m).set(id, f(r)) : m;
      });
    const t0 = performance.now();
    setNow(t0);
    setRuns((m) => new Map(m).set(id, { mode: how, names, t0, startedAt: {}, results: {}, wallMs: null }));
    const one = async (name: string) => {
      const start = performance.now();
      patch((r) => ({ ...r, startedAt: { ...r.startedAt, [name]: start } }));
      const timed = await runEngine(name, file, groundTruth);
      patch((r) => ({ ...r, results: { ...r.results, [name]: timed } }));
    };
    if (how === "parallel") {
      await Promise.all(names.map(one));
    } else {
      for (const name of names) await one(name);
    }
    const wallMs = performance.now() - t0;
    patch((r) => ({ ...r, wallMs }));
  }

  // Reads pages in list order until none is left unread, so pages added during the run get read too.
  async function onRun() {
    if (running || warmingUp || readable.length === 0 || selected.size === 0) return;
    const names = [...selected];
    const how = mode;
    const started = new Set<string>();
    setRuns(new Map());
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
        await readPage(next.id, next.image.file, next.groundTruth, names, how);
      }
    } finally {
      // Whatever happens, a run never leaves the page stuck on "Reading…".
      setRun({ kind: "idle" });
    }
  }

  function runLabel() {
    if (run.kind === "idle") {
      if (warmingUp) return "Getting engines ready…";
      return `Run ${plural(selected.size, "engine")}${readable.length > 1 ? ` on ${plural(readable.length, "page")}` : ""}`;
    }
    const total = run.started.size + readable.filter((p) => !run.started.has(p.id)).length;
    return run.reading
      ? `Reading page ${run.started.size} of ${total}…`
      : `Preparing page ${run.started.size + 1} of ${total}…`;
  }

  function summary(r: PageRun): string {
    const done = r.names.map((name) => r.results[name]).filter((t): t is Timed => t !== undefined);
    if (r.wallMs === null) return `${done.length} of ${plural(r.names.length, "engine")} done · ${seconds(now - r.t0)} s`;
    if (r.mode === "queue") return `${plural(r.names.length, "engine")} one at a time: total ${seconds(r.wallMs)} s`;
    const timeSum = done.reduce((sum, t) => sum + (t.result.ok ? t.roundTripMs : 0), 0);
    return `${plural(r.names.length, "engine")} at once: total ${seconds(r.wallMs)} s, engine times add up to ${seconds(timeSum)} s`;
  }

  function emptyResultsText() {
    if (!page) return "Results appear here, one column per engine.";
    if (page.image.kind === "failed") return "This file can't be read. Remove it from the list.";
    if (run.kind === "running" && !run.started.has(page.id)) return "Waiting for earlier pages…";
    return "Run the engines to read this page.";
  }

  function engineNote(e: EngineStatus): string {
    if (!e.available) return e.reason ?? "";
    const r = readiness[e.name];
    if (r?.state === "warming") return "Getting ready: loading the model and reading a practice page…";
    if (r?.state === "failed") return `Couldn't get ready: ${r.error}`;
    return e.description;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1>OCR Playground</h1>
        <div className={styles.account}>
          <span>{email}</span>
          {signOut && <button type="button" className={styles.linkButton} onClick={signOut}>Sign out</button>}
        </div>
      </header>

      {apiError && <p className={styles.error} role="alert">{apiError}</p>}

      <main className={styles.main}>
        <section className={styles.panel} aria-label="Input">
          <label
            className={styles.drop}
            data-compact={pages.length > 0 || undefined}
            data-dragging={dragging || undefined}
            onPointerEnter={importer.warm}
            onFocus={importer.warm}
            onDragEnter={(e) => {
              importer.warm();
              onDrag(e, true);
            }}
            onDragOver={(e) => onDrag(e, true)}
            onDragLeave={(e) => onDrag(e, false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                addFiles(files);
              }}
            />
            <span>
              {pages.length ? "Drop more images or PDFs here, or click to add" : "Drop images or PDFs here, or click to choose files"}
              <small>PNG, JPG or PDF. Each PDF page becomes its own page.</small>
            </span>
          </label>

          {notices.length > 0 && (
            <ul className={styles.notices} role="status">
              {notices.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}

          {pages.length > 0 && (
            <div className={styles.pages}>
              <div className={styles.pagesHeader}>
                <h2>{plural(pages.length, "page")}</h2>
                <button type="button" className={styles.linkButton} onClick={removeAll}>
                  Remove all
                </button>
              </div>
              <ul ref={pageList} aria-label="Pages">
                {pages.map((p) => (
                  <li key={p.id} className={styles.pageItem}>
                    <button
                      type="button"
                      className={styles.pageSelect}
                      aria-current={p.id === selectedId || undefined}
                      data-page={p.id}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <Thumbnail page={p} />
                      <span className={styles.pageText}>
                        <span className={styles.pageLabel}>{p.label}</span>
                        {p.image.kind === "preparing" && <span className={styles.visuallyHidden}>{" Preparing"}</span>}
                        {p.image.kind === "failed" && <span className={styles.pageError}>{p.image.reason}</span>}
                      </span>
                      {runs.get(p.id)?.wallMs != null && <span className={styles.done}>Done</span>}
                    </button>
                    <button
                      type="button"
                      className={styles.pageRemove}
                      aria-label={`Remove ${p.label}`}
                      onClick={() => removePage(p)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {page?.image.kind === "ready" && (
            // eslint-disable-next-line @next/next/no-img-element -- object URL, next/image can't optimize it
            <img className={styles.preview} src={page.image.url} alt={`Preview of ${page.label}`} />
          )}
          {page?.image.kind === "preparing" && <p className={styles.previewPreparing}>Preparing page…</p>}

          <fieldset className={styles.choices}>
            <legend>Engines</legend>
            {[BROWSER_ENGINE, ...(engines ?? [])].map((e) => (
              <label key={e.name} className={e.available ? undefined : styles.disabled} title={e.reason ?? e.description}>
                <input
                  type="checkbox"
                  disabled={!e.available}
                  checked={selected.has(e.name)}
                  onChange={() => toggle(e.name)}
                />
                <span>
                  <strong>{e.name}</strong>
                  <small aria-live="polite">{engineNote(e)}</small>
                </span>
              </label>
            ))}
            {engines === null && !apiError && <p className={styles.muted}>Loading API engines…</p>}
          </fieldset>

          <fieldset className={styles.choices} disabled={running}>
            <legend>How to run</legend>
            {MODES.map((m) => (
              <label key={m.value}>
                <input type="radio" name="run-mode" checked={mode === m.value} onChange={() => setMode(m.value)} />
                <span>
                  <strong>{m.label}</strong>
                  <small>{m.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>

          <label className={styles.gt}>
            <span>
              Ground truth{page && pages.length > 1 && <> for {page.label}</>} <small>(optional, adds CER)</small>
            </span>
            <textarea
              rows={5}
              value={page?.groundTruth ?? ""}
              disabled={!page || page.image.kind === "failed" || running}
              onChange={(e) => page && dispatch({ type: "groundTruth", id: page.id, text: e.target.value })}
            />
          </label>

          <button
            type="button"
            className={styles.run}
            disabled={running || warmingUp || readable.length === 0 || selected.size === 0}
            onClick={onRun}
          >
            {runLabel()}
          </button>
        </section>

        <section className={styles.results} aria-label="Results" aria-busy={running}>
          {page && <h2 className={styles.resultsTitle}>{page.label}</h2>}
          {pageRun ? <p className={styles.wall}>{summary(pageRun)}</p> : <p className={styles.muted}>{emptyResultsText()}</p>}
          <div className={styles.cards}>
            {pageRun?.names.map((name) => {
              const timed = pageRun.results[name];
              const start = pageRun.startedAt[name];
              if (!timed) {
                return (
                  <article key={name} className={styles.result} aria-busy="true">
                    <header>
                      <h2>{name}</h2>
                      <p className={styles.stats}>
                        {start === undefined ? "waiting for its turn" : `running… ${seconds(now - start)} s`}
                      </p>
                    </header>
                  </article>
                );
              }
              const r = timed.result;
              const shared = pageRun.mode === "parallel" && pageRun.names.length > 1;
              return (
                <article key={name} className={styles.result}>
                  <header>
                    <h2>{r.engine}</h2>
                    {r.ok && (
                      <>
                        <p className={styles.stats}>
                          {seconds(timed.roundTripMs, 2)} s
                          {r.cer !== null && <> · CER {(r.cer * 100).toFixed(1)}%</>}
                          {" · "}{r.format}
                        </p>
                        {r.cold && (
                          <p className={styles.note}>Ran during the engine&apos;s warm-up, so it may read high.</p>
                        )}
                        {shared && (
                          <p className={styles.note}>Timed while other engines ran at once, so it may read high.</p>
                        )}
                      </>
                    )}
                  </header>
                  {r.ok && <StageBreakdown stages={timed.stages} total={timed.roundTripMs} />}
                  {r.ok ? <pre>{r.text}</pre> : <p className={styles.error}>{r.error}</p>}
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function Thumbnail({ page }: { page: Page }) {
  if (page.image.kind === "ready") {
    // eslint-disable-next-line @next/next/no-img-element -- object URL, next/image can't optimize it
    return <img src={page.image.url} alt="" />;
  }
  return (
    <span className={styles.thumb} data-state={page.image.kind} aria-hidden>
      {page.image.kind === "failed" && "!"}
    </span>
  );
}
