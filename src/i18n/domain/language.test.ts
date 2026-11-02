import { describe, expect, it } from "vite-plus/test";
import { resolveLanguage } from "./language";

describe("resolveLanguage", () => {
  it("prefers the language the user chose", () => {
    expect(resolveLanguage("en", ["es-AR"])).toBe("en");
  });

  it("otherwise follows the browser, ignoring the region", () => {
    expect(resolveLanguage(null, ["es-AR"])).toBe("es");
    expect(resolveLanguage(null, ["EN-us"])).toBe("en");
  });

  it("uses the first browser language that is supported", () => {
    expect(resolveLanguage(null, ["fr-FR", "es-MX", "en"])).toBe("es");
  });

  it("falls back to English when nothing is supported", () => {
    expect(resolveLanguage(null, ["fr-FR"])).toBe("en");
    expect(resolveLanguage(null, [])).toBe("en");
  });

  it("ignores an unknown stored value", () => {
    expect(resolveLanguage("klingon", ["es"])).toBe("es");
  });
});
