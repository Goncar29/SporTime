// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { isolate } from "./isolate";

/** Every bidi control: embeddings, overrides, isolates, and the marks. */
const BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

describe("isolate (L64 B1)", () => {
  it("wraps a plain name in first-strong isolates, unchanged", () => {
    expect(isolate("Ana")).toBe("\u2068Ana\u2069");
    expect(isolate("محمد")).toBe("\u2068محمد\u2069");
    expect(isolate("")).toBe("\u2068\u2069");
  });

  it("removes every bidi control inside, so the text cannot close the isolate or reorder others", () => {
    expect(isolate("Piernas\u2069\u202e")).toBe("\u2068Piernas\u2069");
    expect(isolate("\u202eecilA")).toBe("\u2068ecilA\u2069");
    const all =
      "a\u202ab\u202bc\u202cd\u202de\u202ef\u2066g\u2067h\u2068i\u2069j\u200ek\u200fl\u061cm";
    const inside = isolate(all).slice(1, -1);
    expect(inside).toBe("abcdefghijklm");
    expect(inside).not.toMatch(BIDI_CONTROL);
  });

  it("keeps other invisible characters a name may need, such as joiners", () => {
    expect(isolate("👩\u200d💻")).toBe("\u2068👩\u200d💻\u2069");
  });
});
