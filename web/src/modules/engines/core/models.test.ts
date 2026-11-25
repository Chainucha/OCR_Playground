import { describe, expect, it } from "vitest";

import { explainError, modelInfo } from "./models";

describe("modelInfo", () => {
  it("gives the friendly name for a known engine", () => {
    expect(modelInfo("openthai-text-browser")).toMatchObject({ name: "OpenThai Quick · Private", private: true });
  });

  it("falls back to the engine id for an unknown engine", () => {
    expect(modelInfo("new-engine")).toEqual({ name: "new-engine", goodFor: "", badge: null, private: false });
  });
});

describe("explainError", () => {
  it.each([
    ["HTTP 504 Gateway Timeout", "Typhoon is starting up or busy. The first try of the day can take up to a minute. Try again."],
    ["TypeError: Failed to fetch", "We can't reach the server that runs Typhoon. Try again in a moment."],
    ["worker failed to load", "Typhoon couldn't start in this browser. Reload the page and try again."],
    ["boom", "Typhoon couldn't read this page. Try again, or try another model."],
  ])("explains %s in plain words", (raw, expected) => {
    expect(explainError("typhoon", raw)).toBe(expected);
  });
});
