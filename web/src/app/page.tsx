"use client";

import { type DragEvent, useEffect, useReducer, useRef, useState } from "react";
import { type EngineResult, type EngineStatus, OCR_API_URL, listEngines, runOcr } from "@/lib/ocr-api";
import { BROWSER_ENGINE, runInBrowser } from "@/lib/openthai/browser";
import { type Page, createImporter, pagesReducer } from "@/lib/pages";
import styles from "./page.module.css";
import { useSession } from "./providers";

/** `started` holds every page this run has begun reading. `reading` is the one in flight, or null while the next
 * page is still preparing. */
type Run = { kind: "idle" } | { kind: "running"; started: ReadonlySet<string>; reading: string | null };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function Playground() {
  const { email, signOut } = useSession();
  const [engines, setEngines] = useState<EngineStatus[] | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set([BROWSER_ENGINE.name]));
  const [pages, dispatch] = useReducer(pagesReducer, []);
  const [importer] = useState(() => createImporter(dispatch));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<ReadonlyMap<string, EngineResult[]>>(new Map());
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [notices, setNotices] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pageList = useRef<HTMLUListElement>(null);
  // The run loop reads the page list from here, and sleeps on `wake` until the list next changes.
  const latestPages = useRef(pages);
  const wake = useRef<() => void>(undefined);

  const page = pages.find((p) => p.id === selectedId) ?? null;
  const pageResults = page ? results.get(page.id) : undefined;
  const readable = pages.filter((p) => p.image.kind !== "failed");
  const running = run.kind === "running";

  useEffect(() => {
    latestPages.current = pages;
    wake.current?.();
  }, [pages]);

  useEffect(() => {
    listEngines()
      .then((list) => {
        setEngines(list);
        setSelected((s) => new Set([...s, ...list.filter((e) => e.available).map((e) => e.name)]));
      })
      .catch(() =>
        setApiError(
          `Can't reach the engine API at ${OCR_API_URL}, so only the in-browser engine is listed. Start the API with \`uv run ocr serve\` in engines/.`,
        ),
      );
  }, []);

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
    setResults((r) => {
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
    setResults(new Map());
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

  async function readPage(file: File, groundTruth: string, names: string[]): Promise<EngineResult[]> {
    const remote = names.filter((name) => name !== BROWSER_ENGINE.name);
    const [local, api] = await Promise.all([
      names.includes(BROWSER_ENGINE.name) ? runInBrowser(file, groundTruth).then((r) => [r]) : [],
      remote.length
        ? runOcr(file, remote, groundTruth).catch((err) => {
            setApiError(String(err));
            return [];
          })
        : [],
    ]);
    return [...local, ...api];
  }

  // Reads pages in list order until none is left unread, so pages added during the run get read too.
  async function onRun() {
    if (running || readable.length === 0 || selected.size === 0) return;
    const names = [...selected];
    const started = new Set<string>();
    setResults(new Map());
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
      const r = await readPage(next.image.file, next.groundTruth, names);
      if (latestPages.current.some((p) => p.id === next.id)) setResults((m) => new Map(m).set(next.id, r));
    }
    setRun({ kind: "idle" });
  }

  function runLabel() {
    if (run.kind === "idle") {
      return `Run ${plural(selected.size, "engine")}${readable.length > 1 ? ` on ${plural(readable.length, "page")}` : ""}`;
    }
    const total = run.started.size + readable.filter((p) => !run.started.has(p.id)).length;
    return run.reading
      ? `Reading page ${run.started.size} of ${total}…`
      : `Preparing page ${run.started.size + 1} of ${total}…`;
  }

  function emptyResultsText() {
    if (!page) return "Results appear here, one column per engine.";
    if (page.image.kind === "failed") return "This file can't be read. Remove it from the list.";
    if (run.kind === "running") {
      if (page.id === run.reading) return "Reading this page…";
      if (!run.started.has(page.id)) return "Waiting for earlier pages…";
    }
    return "Run the engines to read this page.";
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
                      {results.has(p.id) && <span className={styles.done}>Done</span>}
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

          <fieldset className={styles.engines}>
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
                  <small>{e.available ? e.description : e.reason}</small>
                </span>
              </label>
            ))}
            {engines === null && !apiError && <p className={styles.muted}>Loading API engines…</p>}
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

          <button type="button" className={styles.run} disabled={running || readable.length === 0 || selected.size === 0} onClick={onRun}>
            {runLabel()}
          </button>
        </section>

        <section className={styles.results} aria-label="Results" aria-busy={running}>
          {page && <h2 className={styles.resultsTitle}>{page.label}</h2>}
          {!pageResults?.length && <p className={styles.muted}>{emptyResultsText()}</p>}
          <div className={styles.cards}>
            {pageResults?.map((r) => (
              <article key={r.engine} className={styles.result}>
                <header>
                  <h2>{r.engine}</h2>
                  {r.ok && (
                    <p className={styles.stats}>
                      {Math.round(r.latency_ms)} ms
                      {r.cer !== null && <> · CER {(r.cer * 100).toFixed(1)}%</>}
                      {" · "}{r.format}
                    </p>
                  )}
                </header>
                {r.ok ? <pre>{r.text}</pre> : <p className={styles.error}>{r.error}</p>}
              </article>
            ))}
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
