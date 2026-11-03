import { describe, expect, it } from "vite-plus/test";
import { isRecentSignIn } from "./firebaseAccountIdentity";

describe("isRecentSignIn", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");

  it("trusts a sign-in from under four minutes ago", () => {
    expect(isRecentSignIn("2026-11-02T11:56:30Z", now)).toBe(true);
  });

  it("does not trust an older one, even though Firebase may still accept it", () => {
    expect(isRecentSignIn("2026-11-02T11:56:00Z", now)).toBe(false);
  });

  it("does not trust a time it cannot read", () => {
    expect(isRecentSignIn("not a date", now)).toBe(false);
  });
});
