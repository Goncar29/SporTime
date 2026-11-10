import type { AuthProvider } from "firebase/auth";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createFirebaseAccountIdentity,
  isRecentSignIn,
  meansSessionEnded,
} from "./firebaseAccountIdentity";

const auth = vi.hoisted(() => ({
  currentUser: { uid: "u1" },
  authStateReady: async () => {},
  reauthenticateWithPopup: vi.fn(async () => {}),
  reauthenticateWithRedirect: vi.fn(async () => {}),
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  getAuth: () => auth,
  reauthenticateWithPopup: auth.reauthenticateWithPopup,
  reauthenticateWithRedirect: auth.reauthenticateWithRedirect,
}));

vi.mock("../../shared/firebase/firebaseApp", () => ({ firebaseApp: () => ({}) }));

describe("confirm", () => {
  beforeEach(() => {
    // jsdom has no matchMedia; a desktop browser that is not installed uses the popup.
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    auth.reauthenticateWithPopup.mockClear();
    auth.reauthenticateWithRedirect.mockClear();
  });

  type Call = [unknown, AuthProvider & { getCustomParameters(): object }];
  const parametersOf = (calls: unknown[]) => {
    expect(calls).toHaveLength(1);
    return (calls as Call[]).map(([, provider]) => provider.getCustomParameters())[0];
  };
  const providerParameters = () =>
    parametersOf([
      ...auth.reauthenticateWithPopup.mock.calls,
      ...auth.reauthenticateWithRedirect.mock.calls,
    ]);

  it("makes Google show the account chooser, so deletion never confirms by itself", async () => {
    await createFirebaseAccountIdentity("u1").confirm();
    expect(providerParameters()).toEqual({ prompt: "select_account" });
  });

  it("also shows it when the popup is blocked and it falls back to a redirect", async () => {
    auth.reauthenticateWithPopup.mockRejectedValueOnce({ code: "auth/popup-blocked" });
    await createFirebaseAccountIdentity("u1").confirm();
    expect(parametersOf(auth.reauthenticateWithRedirect.mock.calls)).toEqual({
      prompt: "select_account",
    });
  });
});

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
