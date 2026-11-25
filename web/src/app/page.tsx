"use client";

import { useEffect, useState } from "react";
import { type EngineResult, type EngineStatus, OCR_API_URL, listEngines, runOcr } from "@/lib/ocr-api";
import { BROWSER_ENGINE, runInBrowser } from "@/lib/openthai/browser";
import styles from "./page.module.css";
import { useSession } from "./providers";

export default function Playground() {
  const { email, signOut } = useSession();
  const [engines, setEngines] = useState<EngineStatus[] | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([BROWSER_ENGINE.name]);
  const [file, setFile] = useState<File | null>(null);
  const [groundTruth, setGroundTruth] = useState("");
  const [results, setResults] = useState<EngineResult[]>([]);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    listEngines()
      .then((list) => {
        setEngines(list);
        setSelected((s) => [...s, ...list.filter((e) => e.available).map((e) => e.name)]);
      })
      .catch(() =>
        setApiError(
          `Can't reach the engine API at ${OCR_API_URL}, so only the in-browser engine is listed. Start the API with \`uv run ocr serve\` in engines/.`,
        ),
      );
  }, []);

  function onFile(next: File | null) {
    setFile(next);
    setResults([]);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return next ? URL.createObjectURL(next) : null;
    });
  }

  const toggle = (name: string) =>
    setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));

  async function onRun() {
    if (!file || selected.length === 0) return;
    setRunning(true);
    setResults([]);
    const remote = selected.filter((name) => name !== BROWSER_ENGINE.name);
    const [local, api] = await Promise.all([
      selected.includes(BROWSER_ENGINE.name) ? runInBrowser(file, groundTruth).then((r) => [r]) : [],
      remote.length
        ? runOcr(file, remote, groundTruth).catch((err) => {
            setApiError(String(err));
            return [];
          })
        : [],
    ]);
    setResults([...local, ...api]);
    setRunning(false);
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

          <fieldset className={styles.engines}>
            <legend>Engines</legend>
            {[BROWSER_ENGINE, ...(engines ?? [])].map((e) => (
              <label key={e.name} className={e.available ? undefined : styles.disabled} title={e.reason ?? e.description}>
                <input
                  type="checkbox"
                  disabled={!e.available}
                  checked={selected.includes(e.name)}
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
            <span>Ground truth <small>(optional, adds CER)</small></span>
            <textarea rows={5} value={groundTruth} onChange={(e) => setGroundTruth(e.target.value)} />
          </label>

          <button type="button" className={styles.run} disabled={!file || selected.length === 0 || running} onClick={onRun}>
            {running ? "Running…" : `Run ${selected.length} engine${selected.length === 1 ? "" : "s"}`}
          </button>
        </section>

        <section className={styles.results} aria-label="Results" aria-busy={running}>
          {results.length === 0 && <p className={styles.muted}>Results appear here, one column per engine.</p>}
          {results.map((r) => (
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
        </section>
      </main>
    </div>
  );
}
