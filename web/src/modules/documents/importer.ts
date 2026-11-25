// Turns the files a user adds into pages: one per image, one per PDF page. The engines only ever see images,
// so PDF pages are rendered to PNG here with pdf.js, in the background, one page at a time.

import type { Page, PageEvent } from "./core/pages";

const PDF_SCALE = 200 / 72; // 200 DPI
const UNREADABLE_PDF = "Couldn't open this PDF. It may be damaged or password-protected.";
const UNREADABLE_PAGE = "Couldn't read this page of the PDF.";

/** One PDF being rendered. `ids` are its pages still in the list; when the last one goes, rendering stops. */
type PdfJob = { ids: Set<string>; task?: ReturnType<typeof import("pdfjs-dist").getDocument> };

/**
 * Owns every page's object URL and every PDF render. All structural page events go through it, so a page removed
 * mid-render is known here at once, before React processes the event, and its image is never handed out.
 */
export function createImporter(dispatch: (e: PageEvent) => void) {
  const urls = new Map<string, string>();
  const jobs = new Map<string, PdfJob>();
  let rendering: Promise<unknown> = Promise.resolve();

  function ready(id: string, file: File) {
    const url = URL.createObjectURL(file);
    urls.set(id, url);
    dispatch({ type: "ready", id, file, url });
  }

  function forget(id: string) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
    const job = jobs.get(id);
    jobs.delete(id);
    if (job?.ids.delete(id) && job.ids.size === 0) void job.task?.destroy();
  }

  /** Opens the PDF and turns its placeholder into page 1 of N. Resolves null if it failed or was removed. */
  async function openPdf(file: File, firstId: string, job: PdfJob) {
    try {
      const { getDocument } = await loadPdfjs();
      const data = new Uint8Array(await file.arrayBuffer());
      if (job.ids.size === 0) return null;
      job.task = getDocument({ data });
      const doc = await job.task.promise;
      if (job.ids.size === 0) {
        finish(job);
        return null;
      }
      const pageIds = [firstId, ...Array.from({ length: doc.numPages - 1 }, () => crypto.randomUUID())];
      for (const id of pageIds.slice(1)) {
        job.ids.add(id);
        jobs.set(id, job);
      }
      dispatch({
        type: "expanded",
        id: firstId,
        label: `${file.name} · page 1`,
        after: pageIds.slice(1).map((id, i) => preparing(id, `${file.name} · page ${i + 2}`)),
      });
      return { doc, pageIds };
    } catch {
      if (job.ids.has(firstId)) dispatch({ type: "failed", id: firstId, reason: UNREADABLE_PDF });
      finish(job);
      return null;
    }
  }

  async function renderPdf(file: File, doc: PdfDocument, pageIds: string[], job: PdfJob) {
    const base = file.name.replace(/\.pdf$/i, "");
    for (const [i, id] of pageIds.entries()) {
      if (job.ids.size === 0) break;
      if (!job.ids.has(id)) continue;
      await yieldToMain();
      try {
        const image = await renderPdfPage(doc, i + 1, `${base}-p${i + 1}.png`);
        if (job.ids.has(id)) ready(id, image);
      } catch {
        if (job.ids.has(id)) dispatch({ type: "failed", id, reason: UNREADABLE_PAGE });
      }
    }
    finish(job);
  }

  function finish(job: PdfJob) {
    for (const id of job.ids) jobs.delete(id);
    void job.task?.destroy();
  }

  return {
    /** Adds pages for the files at once and renders PDFs in the background. Returns the first new page's id and
     * the names of files it refused. */
    add(files: File[]): { firstId: string | null; refused: string[] } {
      const added: Page[] = [];
      const refused: string[] = [];
      const pdfs: [File, string, PdfJob][] = [];
      for (const file of files) {
        const id = crypto.randomUUID();
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          urls.set(id, url);
          added.push({ id, label: file.name, groundTruth: "", image: { kind: "ready", file, url } });
        } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
          const job: PdfJob = { ids: new Set([id]) };
          jobs.set(id, job);
          added.push(preparing(id, file.name));
          pdfs.push([file, id, job]);
        } else {
          refused.push(file.name);
        }
      }
      if (added.length) dispatch({ type: "added", pages: added });
      // Every PDF opens at once, so each shows its page count early. Rendering is one page at a time, in list order.
      for (const [file, id, job] of pdfs) {
        const opened = openPdf(file, id, job);
        rendering = rendering.then(() => opened).then((o) => o && renderPdf(file, o.doc, o.pageIds, job));
      }
      return { firstId: added[0]?.id ?? null, refused };
    },
    remove(id: string) {
      forget(id);
      dispatch({ type: "removed", id });
    },
    clear() {
      for (const id of [...urls.keys(), ...jobs.keys()]) forget(id);
      dispatch({ type: "cleared" });
    },
    /** Starts fetching pdf.js before a PDF arrives, so the first one opens without waiting for the download. */
    warm() {
      loadPdfjs().catch(() => {});
    },
  };

  function preparing(id: string, label: string): Page {
    return { id, label, groundTruth: "", image: { kind: "preparing" } };
  }
}

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist").then(
    (lib) => {
      lib.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), {
        type: "module",
      });
      return lib;
    },
    (err) => {
      pdfjs = null;
      throw err;
    },
  );
  return pdfjs;
}

type PdfDocument = Awaited<ReturnType<typeof import("pdfjs-dist").getDocument>["promise"]>;

async function renderPdfPage(doc: PdfDocument, n: number, fileName: string): Promise<File> {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: PDF_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
  if (!blob) throw new Error(`could not encode page ${n}`);
  return new File([blob], fileName, { type: "image/png" });
}

/** Lets clicks and typing in between rendered pages. */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((done) => setTimeout(done, 0));
}
