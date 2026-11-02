import { describe, expect, it } from "vite-plus/test";
import { failureKindFor, signInMethodFor, toUser } from "./firebaseAuthGateway";

describe("toUser", () => {
  it("keeps only the name, email and photo", () => {
    const account = {
      uid: "u1",
      displayName: "Carlos Gonzalez",
      email: "c@example.com",
      photoURL: "https://example.com/p.jpg",
      phoneNumber: "+1555",
      providerId: "firebase",
    };
    expect(toUser(account)).toEqual({
      id: "u1",
      name: "Carlos Gonzalez",
      email: "c@example.com",
      photoUrl: "https://example.com/p.jpg",
    });
  });

  it("tolerates a Google account with no name or photo", () => {
    expect(
      toUser({ uid: "u1", displayName: null, email: "c@example.com", photoURL: null }),
    ).toEqual({
      id: "u1",
      name: "c@example.com",
      email: "c@example.com",
      photoUrl: null,
    });
  });
});

describe("signInMethodFor", () => {
  it("uses a popup in a desktop browser", () => {
    expect(signInMethodFor({ standalone: false, mobile: false })).toBe("popup");
  });

  it("uses a redirect where popups are unreliable", () => {
    expect(signInMethodFor({ standalone: true, mobile: false })).toBe("redirect");
    expect(signInMethodFor({ standalone: false, mobile: true })).toBe("redirect");
  });
});

describe("failureKindFor", () => {
  it("treats a user closing the window as a cancellation, not an error", () => {
    expect(failureKindFor({ code: "auth/popup-closed-by-user" })).toBe("cancelled");
    expect(failureKindFor({ code: "auth/cancelled-popup-request" })).toBe("cancelled");
  });

  it("recognizes a missing connection", () => {
    expect(failureKindFor({ code: "auth/network-request-failed" })).toBe("network");
  });

  it("treats every way of backing out as a cancellation", () => {
    expect(failureKindFor({ code: "auth/user-cancelled" })).toBe("cancelled");
    expect(failureKindFor({ code: "auth/redirect-cancelled-by-user" })).toBe("cancelled");
  });

  it("reports any failure while offline as a missing connection", () => {
    expect(failureKindFor({ code: "auth/internal-error" }, false)).toBe("network");
  });

  it("still treats a cancellation while offline as a cancellation", () => {
    expect(failureKindFor({ code: "auth/popup-closed-by-user" }, false)).toBe("cancelled");
  });

  it("treats anything else as unknown", () => {
    expect(failureKindFor({ code: "auth/unauthorized-domain" })).toBe("unknown");
    expect(failureKindFor(new Error("boom"))).toBe("unknown");
    expect(failureKindFor(undefined)).toBe("unknown");
  });
});
