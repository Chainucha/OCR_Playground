"use client";

import { useEffect, useRef, useState } from "react";
import { type EngineStatus, OCR_API_URL, type Stage, listEngines } from "@/lib/ocr-api";
import { BROWSER_ENGINE } from "@/lib/openthai/browser";
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

/** One press of Run: how it ran, which engines in card order, and when each engine started (performance.now()). */
type Run = { mode: Mode; names: string[]; t0: number; startedAt: Record<string, number>; wallMs: number | null };

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
  const [file, setFile] = useState<File | null>(null);
  const [groundTruth, setGroundTruth] = useState("");
  const [mode, setMode] = useState<Mode>("queue");
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<Record<string, Timed>>({});
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(0);
  const runId = useRef(0);
  const [preview, setPreview] = useState<string | null>(null);

  // As soon as the page opens, every available engine downloads or loads its model and reads a practice page until it
  // is past warm-up, so the first timed run is already a steady one.
  useEffect(() => {
    const prepare = (name: string, runs: number) => {
      setReadiness((r) => ({ ...r, [name]: { state: "warming" } }));
      void warmUp(name, runs).then((state) => setReadiness((r) => ({ ...r, [name]: state })));
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

  function onFile(next: File | null) {
    setFile(next);
    runId.current += 1;
    setRun(null);
    setResults({});
    setRunning(false);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return next ? URL.createObjectURL(next) : null;
    });
  }

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  // Practice pages would slow down a timed run, so Run waits until every engine, selected or not, is done warming up.
  const preparing = Object.values(readiness).some((r) => r.state === "warming");

  // One request per engine, so each card fills in as soon as its engine answers. A card's time runs from sending the
  // request to receiving the result; the total is how long the whole run took.
  async function onRun() {
    if (!file || selected.size === 0 || preparing) return;
    const id = ++runId.current;
    const live = () => runId.current === id;
    const names = [...selected];
    const t0 = performance.now();
    setRun({ mode, names, t0, startedAt: {}, wallMs: null });
    setResults({});
    setNow(t0);
    setRunning(true);

    const one = async (name: string) => {
      const start = performance.now();
      setRun((r) => (live() && r ? { ...r, startedAt: { ...r.startedAt, [name]: start } } : r));
      const timed = await runEngine(name, file, groundTruth);
      if (live()) setResults((prev) => ({ ...prev, [name]: timed }));
    };
    try {
      if (mode === "parallel") {
        await Promise.all(names.map(one));
      } else {
        for (const name of names) {
          if (!live()) return;
          await one(name);
        }
      }
      if (!live()) return;
      const wallMs = performance.now() - t0;
      setRun((r) => (r ? { ...r, wallMs } : r));
    } finally {
      // Whatever happens, a run never leaves the page stuck on "Running…".
      if (live()) setRunning(false);
    }
  }

  const done = run ? run.names.map((name) => results[name]).filter((t): t is Timed => t !== undefined) : [];
  const timeSum = done.reduce((sum, t) => sum + (t.result.ok ? t.roundTripMs : 0), 0);
  const plural = (n: number) => `${n} engine${n === 1 ? "" : "s"}`;

  function summary(r: Run): string {
    if (r.wallMs === null) return `${done.length} of ${plural(r.names.length)} done · ${seconds(now - r.t0)} s`;
    if (r.mode === "queue") return `${plural(r.names.length)} one at a time: total ${seconds(r.wallMs)} s`;
    return `${plural(r.names.length)} at once: total ${seconds(r.wallMs)} s, engine times add up to ${seconds(timeSum)} s`;
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
          <label className={styles.drop}>
            <input type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            {preview ? <img src={preview} alt="Uploaded page" /> : <span>Choose a page image (PNG, JPG)</span>}
          </label>

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
            <span>Ground truth <small>(optional, adds CER)</small></span>
            <textarea rows={5} value={groundTruth} onChange={(e) => setGroundTruth(e.target.value)} />
          </label>

          <button
            type="button"
            className={styles.run}
            disabled={!file || selected.size === 0 || running || preparing}
            onClick={onRun}
          >
            {running ? "Running…" : preparing ? "Getting engines ready…" : `Run ${plural(selected.size)}`}
          </button>
        </section>

        <section className={styles.results} aria-label="Results" aria-busy={running}>
          {!run && <p className={styles.muted}>Results appear here, one column per engine.</p>}
          {run && <p className={styles.wall}>{summary(run)}</p>}
          {run?.names.map((name) => {
            const timed = results[name];
            const start = run.startedAt[name];
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
            const shared = run.mode === "parallel" && run.names.length > 1;
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
        </section>
      </main>
    </div>
  );
}
