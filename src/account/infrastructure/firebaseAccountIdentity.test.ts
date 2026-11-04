import { describe, expect, it } from "vite-plus/test";
import { isRecentSignIn, meansSessionEnded } from "./firebaseAccountIdentity";

describe("isRecentSignIn", () => {
  const issuedAt = "2026-11-02T12:00:00Z";

  it("trusts a sign-in from under four minutes before the token was issued", () => {
    expect(isRecentSignIn("2026-11-02T11:56:30Z", issuedAt)).toBe(true);
  });

  it("does not trust an older one, even though Firebase may still accept it", () => {
    expect(isRecentSignIn("2026-11-02T11:56:00Z", issuedAt)).toBe(false);
  });

  it("does not trust a time it cannot read", () => {
    expect(isRecentSignIn("not a date", issuedAt)).toBe(false);
    expect(isRecentSignIn(issuedAt, "not a date")).toBe(false);
  });
});

describe("meansSessionEnded", () => {
  it("recognizes the provider refusing the session or the account", () => {
    expect(meansSessionEnded("auth/user-token-expired")).toBe(true);
    expect(meansSessionEnded("auth/user-not-found")).toBe(true);
    expect(meansSessionEnded("auth/invalid-user-token")).toBe(true);
    expect(meansSessionEnded("auth/invalid-refresh-token")).toBe(true);
  });

  it("does not mistake a connection problem for it", () => {
    expect(meansSessionEnded("auth/network-request-failed")).toBe(false);
    expect(meansSessionEnded(undefined)).toBe(false);
  });
});
