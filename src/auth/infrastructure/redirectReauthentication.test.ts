import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const firebase = vi.hoisted(() => ({
  getRedirectResult: vi.fn<() => Promise<unknown>>(),
  signInWithRedirect: vi.fn<() => Promise<never>>(),
}));

vi.mock("firebase/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("firebase/auth")>()),
  getAuth: () => ({}),
  getRedirectResult: firebase.getRedirectResult,
  signInWithRedirect: firebase.signInWithRedirect,
}));

vi.mock("../../shared/firebase/firebaseApp", () => ({ firebaseApp: () => ({}) }));

/** A fresh module per test, since the shared read lives for the whole page load. */
async function freshGateway() {
  vi.resetModules();
  return import("./firebaseAuthGateway");
}

const result = (operationType: string, uid = "u1") => ({ operationType, user: { uid } });

describe("redirectReauthenticatedUserId", () => {
  beforeEach(() => {
    firebase.getRedirectResult.mockReset();
  });

  it("names the account Google re-confirmed in this page's redirect", async () => {
    firebase.getRedirectResult.mockResolvedValue(result("reauthenticate"));
    const { redirectReauthenticatedUserId } = await freshGateway();
    await expect(redirectReauthenticatedUserId()).resolves.toBe("u1");
  });

  it("ignores a sign-in or a link, so they can never start a deletion", async () => {
    for (const operationType of ["signIn", "link"]) {
      firebase.getRedirectResult.mockResolvedValue(result(operationType));
      const { redirectReauthenticatedUserId } = await freshGateway();
      await expect(redirectReauthenticatedUserId()).resolves.toBeNull();
    }
  });

  it("is null when the page did not come back from a redirect", async () => {
    firebase.getRedirectResult.mockResolvedValue(null);
    const { redirectReauthenticatedUserId } = await freshGateway();
    await expect(redirectReauthenticatedUserId()).resolves.toBeNull();
  });

  it("is null for a failed redirect, which the sign-in screen still reports", async () => {
    firebase.getRedirectResult.mockRejectedValue({ code: "auth/network-request-failed" });
    const { redirectReauthenticatedUserId, createFirebaseAuthGateway } = await freshGateway();
    await expect(redirectReauthenticatedUserId()).resolves.toBeNull();
    await expect(createFirebaseAuthGateway().completePendingSignIn()).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("shares Firebase's single read with the pending sign-in", async () => {
    // Firebase hands the result to its first reader only; later reads get null.
    firebase.getRedirectResult
      .mockResolvedValueOnce(result("reauthenticate"))
      .mockResolvedValue(null);
    const { redirectReauthenticatedUserId, createFirebaseAuthGateway } = await freshGateway();
    await createFirebaseAuthGateway().completePendingSignIn();
    await expect(redirectReauthenticatedUserId()).resolves.toBe("u1");
    expect(firebase.getRedirectResult).toHaveBeenCalledOnce();
  });
});

describe("firebaseRedirectPending", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("is true while Firebase has a redirect sign-in on its way back", async () => {
    sessionStorage.setItem("firebase:pendingRedirect:key:[DEFAULT]", '"true"');
    const { firebaseRedirectPending } = await freshGateway();
    expect(firebaseRedirectPending()).toBe(true);
  });

  it("is true once the app leaves for a redirect sign-in, whatever Firebase stores", async () => {
    // An installed app signs in through a redirect.
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    let pendingWhenLeaving = false;
    const { createFirebaseAuthGateway, firebaseRedirectPending } = await freshGateway();
    firebase.signInWithRedirect.mockImplementationOnce(() => {
      pendingWhenLeaving = firebaseRedirectPending();
      // The page is leaving, so this never settles.
      return new Promise<never>(() => undefined);
    });
    void createFirebaseAuthGateway().signIn();
    await vi.waitFor(() => {
      expect(pendingWhenLeaving).toBe(true);
    });
    vi.unstubAllGlobals();
  });

  it("is false again once the redirect's result is read", async () => {
    sessionStorage.setItem("sportime.redirectSignIn", "true");
    firebase.getRedirectResult.mockResolvedValue(null);
    const { createFirebaseAuthGateway, firebaseRedirectPending } = await freshGateway();
    await createFirebaseAuthGateway().completePendingSignIn();
    expect(firebaseRedirectPending()).toBe(false);
  });

  it("is false again when the redirect never left the page", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    firebase.signInWithRedirect.mockRejectedValueOnce(
      Object.assign(new Error("no"), { code: "auth/network-request-failed" }),
    );
    const { createFirebaseAuthGateway, firebaseRedirectPending } = await freshGateway();
    await expect(createFirebaseAuthGateway().signIn()).rejects.toThrow();
    expect(firebaseRedirectPending()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("is false when session storage cannot be read", async () => {
    const { firebaseRedirectPending } = await freshGateway();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Object, "keys").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(firebaseRedirectPending()).toBe(false);
    vi.restoreAllMocks();
  });

  it("is false otherwise", async () => {
    sessionStorage.setItem("firebase:authUser:key:[DEFAULT]", "{}");
    const { firebaseRedirectPending } = await freshGateway();
    expect(firebaseRedirectPending()).toBe(false);
  });
});
