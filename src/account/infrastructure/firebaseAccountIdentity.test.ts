import { describe, expect, it } from "vite-plus/test";
import { isRecentSignIn, meansAccountIsGone } from "./firebaseAccountIdentity";

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

describe("meansAccountIsGone", () => {
  it("recognizes the provider saying the account no longer exists", () => {
    expect(meansAccountIsGone("auth/user-token-expired")).toBe(true);
    expect(meansAccountIsGone("auth/user-not-found")).toBe(true);
    expect(meansAccountIsGone("auth/invalid-user-token")).toBe(true);
    expect(meansAccountIsGone("auth/invalid-refresh-token")).toBe(true);
  });

  it("does not mistake a connection problem for it", () => {
    expect(meansAccountIsGone("auth/network-request-failed")).toBe(false);
    expect(meansAccountIsGone(undefined)).toBe(false);
  });
});
