import { describe, expect, it } from "vitest";

import { type Page, pagesReducer } from "./pages";

const page = (id: string): Page => ({ id, label: id, groundTruth: "", image: { kind: "preparing" } });

describe("pagesReducer", () => {
  it("puts a PDF's later pages right after its first page", () => {
    const start = [page("a"), page("pdf"), page("z")];
    const next = pagesReducer(start, { type: "expanded", id: "pdf", label: "doc.pdf · page 1", after: [page("p2")] });
    expect(next.map((p) => p.id)).toEqual(["a", "pdf", "p2", "z"]);
    expect(next[1].label).toBe("doc.pdf · page 1");
  });

  it("ignores events for a page that was removed", () => {
    const start = [page("a")];
    expect(pagesReducer(start, { type: "failed", id: "gone", reason: "x" })).toBe(start);
    expect(pagesReducer(start, { type: "expanded", id: "gone", label: "x", after: [] })).toBe(start);
  });

  it("stores the correct text per page", () => {
    const next = pagesReducer([page("a"), page("b")], { type: "groundTruth", id: "b", text: "hello" });
    expect(next.map((p) => p.groundTruth)).toEqual(["", "hello"]);
  });

  it("removes one page or all of them", () => {
    expect(pagesReducer([page("a"), page("b")], { type: "removed", id: "a" }).map((p) => p.id)).toEqual(["b"]);
    expect(pagesReducer([page("a")], { type: "cleared" })).toEqual([]);
  });
});
