import { describe, expect, it } from "vitest";
import { enumNumber, gaps, readingOrder, startRep } from "./columns";
import { CFG } from "./config";
import type { Quad } from "./image";

const box = (x0: number, y0: number, x1: number, y1: number): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const WORDS = ["การ", "ประชุม", "ครั้ง", "นี้", "มี", "วาระ", "เรื่อง", "งบประมาณ", "และ", "แผนงาน", "ประจำ", "ปี"];
/** A distinct line of prose. */
const prose = (n: number) => `${WORDS[n % 12]}${WORDS[(n * 5 + 3) % 12]} ${WORDS[(n * 7 + 1) % 12]}ที่ ${n} ${WORDS[(n + 4) % 12]}`;

/** Lines of one column: `n` rows 30 px apart, 20 px tall, all full width but the paragraph ends. */
function column(x0: number, x1: number, y0: number, n: number, first: number) {
  return Array.from({ length: n }, (_, i) => ({
    box: box(x0, y0 + i * 30, i % 5 === 4 ? x0 + (x1 - x0) * 0.6 : x1, y0 + i * 30 + 20),
    text: prose(first + i),
  }));
}

function order(lines: { box: Quad; text: string }[]): string[][] {
  return readingOrder(lines.map((l) => l.box), 0, lines.map((l) => l.text), CFG.cols).map((r) => r.map((i) => lines[i].text));
}

describe("readingOrder", () => {
  it("reads two prose columns one after the other", () => {
    const left = column(0, 400, 0, 14, 0), right = column(460, 860, 0, 14, 100);
    const rows = order([...left, ...right]);
    expect(rows.flat()).toEqual([...left, ...right].map((l) => l.text));
    expect(rows.every((r) => r.length === 1)).toBe(true);
  });

  it("reads a table row by row, each amount next to its label", () => {
    const lines = Array.from({ length: 14 }, (_, i) => [
      { box: box(0, i * 30, 200, i * 30 + 20), text: `รายการที่ ${i}` },
      { box: box(260, i * 30, 320, i * 30 + 20), text: `${i + 1}` },
      { box: box(380, i * 30, 480, i * 30 + 20), text: `${(i + 1) * 120}.00` },
    ]).flat();
    expect(order(lines)).toEqual(Array.from({ length: 14 }, (_, i) => [`รายการที่ ${i}`, `${i + 1}`, `${(i + 1) * 120}.00`]));
  });

  it("reads a list of names and positions row by row, though each side looks like prose", () => {
    const names = ["สมชาย ใจดี", "สมหญิง รักไทย", "ประเสริฐ มั่นคง", "วิไล ศรีสุข", "อนันต์ ทองดี", "สุนทร แก้วใส",
      "มาลี ชื่นใจ", "ชัยวัฒน์ บุญมา", "พรทิพย์ สายทอง", "วีระ กล้าหาญ", "รัตนา ใจงาม", "สมศักดิ์ ดีงาม", "กมล สุขใจ", "ปรีชา เก่งกล้า"];
    const lines = names.flatMap((name, i) => [
      { box: box(0, i * 30, 400, i * 30 + 20), text: `นาย${name} ผู้แทนหน่วยงานที่ ${i + 1}` },
      { box: box(460, i * 30, 860, i * 30 + 20), text: `กรรมการและผู้ช่วยเลขานุการฝ่ายที่ ${i + 1}` },
    ]);
    const rows = order(lines);
    expect(rows).toHaveLength(14);
    expect(rows.every((r) => r.length === 2 && r[0].startsWith("นาย") && r[1].startsWith("กรรมการ"))).toBe(true);
  });

  it("reads a title over two columns first, then each column, though no gap sets the title apart", () => {
    const title = { box: box(0, 0, 860, 20), text: "ข้อบังคับเกี่ยวกับการทำงาน หมวดที่ ๑" };
    const left = column(0, 400, 26, 13, 0), right = column(460, 860, 26, 13, 100);
    expect(order([...left, title, ...right]).flat()).toEqual([title, ...left, ...right].map((l) => l.text));
  });

  it("groups a table row's cells on a page scanned slightly off level", () => {
    const tilt = (q: Quad): Quad => q.map(([x, y]) => [x, y + x * Math.tan((1 * Math.PI) / 180)]) as Quad;
    const lines = Array.from({ length: 4 }, (_, i) => [box(0, i * 30, 300, i * 30 + 20), box(1200, i * 30, 1500, i * 30 + 20)])
      .flat().map(tilt);
    expect(readingOrder(lines, 1)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7]]);
  });
});

describe("column helpers", () => {
  it("finds empty bands between intervals", () => {
    expect(gaps([[0, 10], [5, 20], [30, 40], [41, 50]], 5)).toEqual([[20, 30]]);
  });

  it("reads the number a list line starts with, Thai digits too", () => {
    expect(enumNumber("12. ข้อความ")).toBe(12);
    expect(enumNumber("(๓) ข้อความ")).toBe(3);
    expect(enumNumber("ข้อ 3.")).toBeNull();
  });

  it("measures how alike lines start, a digit run counted as one", () => {
    expect(startRep(["1. ก", "2. ข", "10. ค", "นาย ง"])).toBe(1);
    expect(startRep(["กขค", "งจฉ", "ชซฌ", "ญฎฏ"])).toBe(0.5);
  });
});
