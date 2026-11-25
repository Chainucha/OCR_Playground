import { describe, expect, it } from "vitest";

import { type Batch, type Slot, accuracy, bestEngine, progressLine, readLabel } from "./run";

const done = (engine: string, cer: number | null, ms = 1000): Slot => ({
  engine,
  status: "done",
  ms,
  stages: [],
  diff: null,
  result: { ok: true, engine, text: "", format: "text", latency_ms: ms, lines: [], cer, cold: false },
});

describe("accuracy", () => {
  it("never rounds a page with mistakes up to 100%", () => {
    expect(accuracy(0)).toBe("100%");
    expect(accuracy(0.0001)).toBe("99.9%");
    expect(accuracy(0.25)).toBe("75.0%");
    expect(accuracy(2)).toBe("0.0%");
  });
});

describe("bestEngine", () => {
  it("names the one model with the fewest mistakes", () => {
    expect(bestEngine([done("a", 0.1), done("b", 0.05)])).toBe("b");
  });

  it("names nobody on a tie, with one score, or without correct text", () => {
    expect(bestEngine([done("a", 0.1), done("b", 0.1)])).toBeNull();
    expect(bestEngine([done("a", 0.1), { engine: "b", status: "reading", startedAt: 0 }])).toBeNull();
    expect(bestEngine([done("a", null), done("b", null)])).toBeNull();
  });
});

describe("readLabel", () => {
  const pages = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];

  it("says what Read will do before a read", () => {
    expect(readLabel({ kind: "idle" }, pages.slice(0, 1), 1, false)).toBe("Read with 1 model");
    expect(readLabel({ kind: "idle" }, pages, 2, false)).toBe("Read 3 pages with 2 models");
    expect(readLabel({ kind: "idle" }, pages, 2, true)).toBe("Getting models ready…");
  });

  it("counts pages during a read", () => {
    const started = new Set(["p1", "p2"]);
    expect(readLabel({ kind: "running", started, reading: "p2" }, pages, 2, false)).toBe("Reading page 2 of 3…");
    expect(readLabel({ kind: "running", started, reading: null }, pages, 2, false)).toBe("Preparing page 3 of 3…");
    expect(readLabel({ kind: "running", started, reading: "p1" }, pages.slice(0, 1), 2, false)).toBe("Reading…");
  });
});

describe("progressLine", () => {
  it("counts each state while models read", () => {
    const batch: Batch = {
      mode: "queue",
      reference: "",
      totalMs: null,
      slots: [done("a", null), { engine: "b", status: "reading", startedAt: 0 }, { engine: "c", status: "waiting" }],
    };
    expect(progressLine(batch)).toBe("1 finished · 1 reading · 1 waiting its turn");
  });

  it("adds the total time when every model has answered", () => {
    const slots = [done("a", null, 1200), done("b", null, 800), { engine: "c", status: "failed", error: "x" } as Slot];
    expect(progressLine({ mode: "queue", reference: "", totalMs: 2000, slots })).toBe(
      "2 finished · 1 needs another try · one at a time, 2.0 sec in total",
    );
    expect(progressLine({ mode: "parallel", reference: "", totalMs: 1300, slots })).toBe(
      "2 finished · 1 needs another try · all at once, 1.3 sec in total (the separate times add up to 2.0 sec)",
    );
  });
});
