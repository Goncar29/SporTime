import { describe, expect, it } from "vite-plus/test";
import { isolate } from "./ContactAvatar";

describe("isolate (contact names)", () => {
  it("keeps a stray bidi control inside a contact name from escaping its isolate (L64 B1)", () => {
    expect(isolate("Ana\u2069\u202e")).toBe("\u2068Ana\u2069");
    expect(isolate("Ana")).toBe("\u2068Ana\u2069");
  });
});
