import { beforeEach, expect, it, vi } from "vite-plus/test";
import { createFirebaseSenderIdentity } from "./firebaseSenderIdentity";

const auth = vi.hoisted(() => ({
  currentUser: null as null | {
    uid: string;
    getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }>;
  },
}));

vi.mock("../../shared/firebase/firebaseApp", () => ({ firebaseApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({
    get currentUser() {
      return auth.currentUser;
    },
  }),
}));

const signedIn = (uid: string, claims: Record<string, unknown> | Error) => {
  auth.currentUser = {
    uid,
    getIdTokenResult: () =>
      claims instanceof Error ? Promise.reject(claims) : Promise.resolve({ claims }),
  };
};

beforeEach(() => {
  auth.currentUser = null;
});

it("reads the sender from the ID token's claims, as they are", async () => {
  signedIn("alice", {
    email: "Alice@Example.com",
    email_verified: true,
    name: "Alice Liddell",
    picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
  });
  expect(await createFirebaseSenderIdentity("alice").claims()).toEqual({
    uid: "alice",
    email: "Alice@Example.com",
    emailVerified: true,
    name: "Alice Liddell",
    picture: "https://lh3.googleusercontent.com/a/alice=s96-c",
  });
});

it("leaves out claims the token lacks, and an unverified email stays unverified", async () => {
  signedIn("alice", { email: "a@x.com", email_verified: "true" });
  expect(await createFirebaseSenderIdentity("alice").claims()).toEqual({
    uid: "alice",
    email: "a@x.com",
    emailVerified: false,
  });
});

it("says the session ended when another account, or none, is signed in", async () => {
  await expect(createFirebaseSenderIdentity("alice").claims()).rejects.toMatchObject({
    code: "unauthenticated",
  });
  signedIn("bob", { email: "b@x.com", email_verified: true });
  await expect(createFirebaseSenderIdentity("alice").claims()).rejects.toMatchObject({
    code: "unauthenticated",
  });
});

it("says it is offline when the token cannot be refreshed without a connection", async () => {
  signedIn("alice", Object.assign(new Error("net"), { code: "auth/network-request-failed" }));
  await expect(createFirebaseSenderIdentity("alice").claims()).rejects.toMatchObject({
    code: "unavailable",
  });
});
