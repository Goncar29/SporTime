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

const redirect = vi.hoisted(() => ({
  reauthenticatedUserId: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../../auth/infrastructure/firebaseAuthGateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth/infrastructure/firebaseAuthGateway")>()),
  redirectReauthenticatedUserId: redirect.reauthenticatedUserId,
}));

const PENDING_KEY = "sportime.pendingDeletion";

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

  it("lets Google re-confirm without forcing its chooser, since the modal already asked", async () => {
    await createFirebaseAccountIdentity("u1").confirm();
    expect(providerParameters()).toEqual({});
  });

  it("does not force it on the plain redirect path of an installed app either", async () => {
    // Installed (standalone) apps re-authenticate with a redirect straight away.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await createFirebaseAccountIdentity("u1").confirm();
    expect(auth.reauthenticateWithPopup).not.toHaveBeenCalled();
    expect(parametersOf(auth.reauthenticateWithRedirect.mock.calls)).toEqual({});
  });

  it("remembers the deletion before leaving for a redirect, and only then", async () => {
    sessionStorage.clear();
    await createFirebaseAccountIdentity("u1").confirm();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();

    auth.reauthenticateWithPopup.mockRejectedValueOnce({ code: "auth/popup-blocked" });
    await createFirebaseAccountIdentity("u1").confirm();
    expect(parametersOf(auth.reauthenticateWithRedirect.mock.calls)).toEqual({});
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null")).toMatchObject({
      userId: "u1",
    });
  });
});

describe("confirm, when the redirect cannot start", () => {
  it("forgets the deletion it was about to remember", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    sessionStorage.clear();
    auth.reauthenticateWithRedirect.mockRejectedValueOnce({
      code: "auth/network-request-failed",
    });
    await expect(createFirebaseAccountIdentity("u1").confirm()).rejects.toMatchObject({
      kind: "network",
    });
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("confirmedByRedirect", () => {
  const pending = (userId: string, at = Date.now()) => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ userId, at }));
  };

  beforeEach(() => {
    sessionStorage.clear();
    redirect.reauthenticatedUserId.mockReset();
    redirect.reauthenticatedUserId.mockResolvedValue("u1");
  });

  it("is true once Google re-confirmed this account for a deletion it asked for", async () => {
    pending("u1");
    const identity = createFirebaseAccountIdentity("u1");
    await expect(identity.confirmedByRedirect()).resolves.toBe(true);
    // Used up, so a reload cannot delete a second time by itself.
    await expect(identity.confirmedByRedirect()).resolves.toBe(false);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("is false when the user came back without Google confirming anything", async () => {
    pending("u1");
    redirect.reauthenticatedUserId.mockResolvedValue(null);
    await expect(createFirebaseAccountIdentity("u1").confirmedByRedirect()).resolves.toBe(false);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("is false when nobody asked to delete, even right after a re-confirmation", async () => {
    await expect(createFirebaseAccountIdentity("u1").confirmedByRedirect()).resolves.toBe(false);
  });

  it("is false for another account's request or another account's confirmation", async () => {
    pending("u2");
    await expect(createFirebaseAccountIdentity("u1").confirmedByRedirect()).resolves.toBe(false);
    pending("u1");
    redirect.reauthenticatedUserId.mockResolvedValue("u2");
    await expect(createFirebaseAccountIdentity("u1").confirmedByRedirect()).resolves.toBe(false);
  });

  it("is false for a request older than the window Firebase allows", async () => {
    pending("u1", Date.now() - 5 * 60 * 1_000);
    await expect(createFirebaseAccountIdentity("u1").confirmedByRedirect()).resolves.toBe(false);
  });

  it("is false for a request it cannot read", async () => {
    sessionStorage.setItem(PENDING_KEY, "{not json");
    await expect(createFirebaseAccountIdentity("u1").confirmedByRedirect()).resolves.toBe(false);
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
