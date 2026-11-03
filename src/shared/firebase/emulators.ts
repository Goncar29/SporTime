import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
} from "firebase/auth";

declare global {
  interface Window {
    signInForTest(name: string): Promise<unknown>;
    currentUidForTest(): string | null;
  }
}

/**
 * Browser tests only: runs the real adapters against the local emulators and a
 * `demo-` project, which cannot reach real data. Never part of a production build.
 */
export function connectToEmulators(): void {
  const app = initializeApp({
    apiKey: "demo-key",
    authDomain: "localhost",
    projectId: "demo-sportime",
    appId: "demo-app",
  });
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

  window.signInForTest = (name) =>
    signInWithCredential(
      auth,
      GoogleAuthProvider.credential(
        JSON.stringify({ sub: name, name, email: `${name}@example.com`, email_verified: true }),
      ),
    );
  window.currentUidForTest = () => auth.currentUser?.uid ?? null;
}
