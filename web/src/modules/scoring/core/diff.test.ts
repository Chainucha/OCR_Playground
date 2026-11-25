import { describe, expect, it } from "vitest";

import { diffWords, toLines, toPlainText } from "./diff";

describe("toPlainText", () => {
  it("keeps line breaks from table rows and drops markup", () => {
    expect(toPlainText("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>")).toBe("a b\nc");
    expect(toPlainText("| a | b |\n|---|---|\n| c | d |")).toBe("a b\n\nc d");
  });
});

describe("diffWords", () => {
  it("finds no mistakes in identical text", () => {
    expect(diffWords("ราคา 100 บาท", "ราคา 100 บาท")).toEqual({
      segments: [{ kind: "same", text: "ราคา 100 บาท" }],
      mistakes: 0,
    });
  });

  it("marks a misread word as what the page says, then what the model wrote", () => {
    const diff = diffWords("เพิ่ม ราคา", "เพิม ราคา");
    expect(diff?.segments).toEqual([
      { kind: "missing", text: "เพิ่ม" },
      { kind: "extra", text: "เพิม" },
      { kind: "same", text: " ราคา" },
    ]);
    expect(diff?.mistakes).toBe(1);
  });

  it("counts separate runs of wrong words as separate mistakes", () => {
    expect(diffWords("a b c d e", "x b c d y")?.mistakes).toBe(2);
  });
});

describe("toLines", () => {
  it("splits the text into lines and marks the ones the model wrote as headings", () => {
    const lines = toLines("# ใบกำกับภาษี\nราคา 100\n<h2>รวม</h2>");
    expect(lines.map((l) => [l.heading, l.segments.map((s) => s.text).join("")])).toEqual([
      [true, "ใบกำกับภาษี"],
      [false, "ราคา 100"],
      [true, "รวม"],
    ]);
  });

  it("keeps the mistake marks, split at line breaks", () => {
    const diff = diffWords("ราคา\nเพิ่ม", "ราคา\nเพิม");
    const lines = toLines("ราคา\nเพิม", diff?.segments);
    expect(lines).toHaveLength(2);
    expect(lines[1].segments.map((s) => s.kind)).toEqual(["missing", "extra"]);
  });
});
