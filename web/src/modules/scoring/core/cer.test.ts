import { describe, expect, it } from "vitest";

import { cer, normalize } from "./cer";

describe("normalize", () => {
  it("drops markup and whitespace and composes sara am", () => {
    expect(normalize("# หัว\n<td>ก ข</td> **น้ํา**")).toBe("หัวกขน้ำ");
  });
});

describe("cer", () => {
  it("is 0 for the same text with different spacing", () => {
    expect(cer("สวัสดี ครับ", "สวัสดีครับ")).toBe(0);
  });

  it("counts edits against the reference length", () => {
    expect(cer("abcd", "abxd")).toBe(0.25);
  });

  it("is 1 for an empty reference with any output, 0 with none", () => {
    expect(cer("", "x")).toBe(1);
    expect(cer("", "")).toBe(0);
  });
});
