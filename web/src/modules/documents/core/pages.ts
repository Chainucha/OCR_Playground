// The pages a user adds and how the list changes. Plain TypeScript: the browser work lives in importer.ts.

export type PageImage =
  | { kind: "preparing" }
  | { kind: "ready"; file: File; url: string }
  | { kind: "failed"; reason: string };

export type Page = {
  id: string;
  /** "receipt.png", "contract.pdf" before it opens, then "contract.pdf · page 3" */
  label: string;
  groundTruth: string;
  image: PageImage;
};

export type PageEvent =
  | { type: "added"; pages: Page[] }
  /** A PDF opened: its placeholder becomes page 1 and the other pages follow it. */
  | { type: "expanded"; id: string; label: string; after: Page[] }
  | { type: "ready"; id: string; file: File; url: string }
  | { type: "failed"; id: string; reason: string }
  | { type: "removed"; id: string }
  | { type: "cleared" }
  | { type: "groundTruth"; id: string; text: string };

export function pagesReducer(pages: Page[], e: PageEvent): Page[] {
  switch (e.type) {
    case "added":
      return [...pages, ...e.pages];
    case "expanded": {
      const i = pages.findIndex((p) => p.id === e.id);
      if (i < 0) return pages;
      return [...pages.slice(0, i), { ...pages[i], label: e.label }, ...e.after, ...pages.slice(i + 1)];
    }
    case "ready":
      return update(pages, e.id, { image: { kind: "ready", file: e.file, url: e.url } });
    case "failed":
      return update(pages, e.id, { image: { kind: "failed", reason: e.reason } });
    case "removed":
      return pages.filter((p) => p.id !== e.id);
    case "cleared":
      return [];
    case "groundTruth":
      return update(pages, e.id, { groundTruth: e.text });
  }
}

function update(pages: Page[], id: string, patch: Partial<Page>): Page[] {
  return pages.some((p) => p.id === id) ? pages.map((p) => (p.id === id ? { ...p, ...patch } : p)) : pages;
}
