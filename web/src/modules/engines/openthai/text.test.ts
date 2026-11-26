import { afterEach, describe, expect, it } from "vitest";
import { CFG } from "./config";
import { canonical, dropReason, joinRows, lineText } from "./text";
import type { Char } from "./types";
import { words } from "./words";

const join = { ...CFG.join };
afterEach(() => Object.assign(CFG.join, join));

describe("joinRows", () => {
  const rows = ["บรรทัดแรก", "บรรทัดสอง", "Third line"];
  const geom: [number, number][] = [[0, 20], [25, 45], [100, 120]];

  it("puts one row per line", () => {
    expect(joinRows(rows, geom, 20)).toBe("บรรทัดแรก\nบรรทัดสอง\nThird line");
  });

  it("leaves a blank line where rows are far apart, with paragraphs on", () => {
    CFG.join.paragraphs = true;
    expect(joinRows(rows, geom, 20)).toBe("บรรทัดแรก\nบรรทัดสอง\n\nThird line");
  });

  it("leaves a blank line where reading moves back up the page, with paragraphs on", () => {
    CFG.join.paragraphs = true;
    expect(joinRows(["ซ้าย", "ขวา"], [[100, 120], [0, 20]], 20)).toBe("ซ้าย\n\nขวา");
  });

  it("joins a Thai line wrap without a break, with thai_no_space on", () => {
    CFG.join.thaiNoSpace = true;
    expect(joinRows(rows, geom, 20)).toBe("บรรทัดแรกบรรทัดสอง\nThird line");
  });
});

describe("line text and the line filter", () => {
  it("writes Thai one way and makes decimal commas points", () => {
    expect(canonical("น้ํา")).toBe("น้ำ");
    expect(lineText("รวม 1,130,00 บาท")).toBe("รวม 1,130.00 บาท");
    expect(lineText("W.ศ. ๒o๕๖")).toBe("พ.ศ. ๒๐๕๖");
  });

  it("keeps a lone table digit only when it is as tall as a line", () => {
    expect(dropReason("2", 0.95, 0.9)).toBeNull();
    expect(dropReason("2", 0.95, 0.4)).toBe("too_short");
    expect(dropReason("2", 0.95)).toBe("too_short");
    expect(dropReason("ก", 0.95, 0.9)).toBe("too_short");
  });

  it("drops unconfident lines and broken Thai spelling", () => {
    expect(dropReason("สวัสดี", 0.7, 1)).toBe("low_confidence");
    expect(dropReason("ูี้ซ์ ริ ร้ร้ ไ้", 0.85, 1)).toBe("invalid_thai");
    expect(dropReason("สวัสดี", 0.85, 1)).toBeNull();
  });
});

describe("words", () => {
  const ch = (c: string, x0: number, x1: number): Char => ({ ch: c, x0, x1, p: 0.9 });
  const line: [number, number][] = [[0, 0], [100, 0], [100, 20], [0, 20]];

  it("cuts a line at its spaces and leaves a gap where each space is", () => {
    const chars = [ch("ก", 0.1, 0.12), ch("า", 0.2, 0.22), ch(" ", 0.4, 0.42), ch("ข", 0.6, 0.62), ch("า", 0.7, 0.72)];
    const ws = words(chars, line as never, "กา ขา", 0.9);
    expect(ws.map((w) => w.text)).toEqual(["กา", "ขา"]);
    expect(ws[0].box[1][0]).toBeLessThan(41);
    expect(ws[1].box[0][0]).toBeGreaterThan(41);
    expect(ws[0].box[0][0]).toBeCloseTo(0, 6);
  });

  it("gives the whole line as one word when it was read turned", () => {
    expect(words(null, line as never, "กา", 0.9)).toEqual([{ text: "กา", confidence: 0.9, box: line }]);
  });
});
