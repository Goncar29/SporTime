import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-800-italic.css";
import "./app/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SignedInApp, type UserStores } from "./app/SignedInApp";
import type { AuthGateway } from "./auth/application/ports";
import { AccountMenu } from "./auth/ui/AccountMenu";
import { AuthGate } from "./auth/ui/AuthGate";
import { localStorageLanguageStore } from "./i18n/infrastructure/localStorageLanguageStore";
import { I18nProvider } from "./i18n/ui/I18nProvider";
import {
  createWakeLockScreenAwake,
  createWebAudioCuePlayer,
  systemClock,
} from "./timer/infrastructure/browserTimerAdapters";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const timer = {
  clock: systemClock,
  cues: createWebAudioCuePlayer(),
  screenAwake: createWakeLockScreenAwake(),
};

// Decided at build time, so the fake gateway is never shipped in a production build.
async function createAuthGateway(): Promise<AuthGateway> {
  if (import.meta.env.MODE === "e2e") {
    const { createFakeAuthGateway } = await import("./auth/infrastructure/fakeAuthGateway");
    return createFakeAuthGateway();
  }
  const [{ createFirebaseAuthGateway }, { withCachedSession }, { localStorageSessionStore }] =
    await Promise.all([
      import("./auth/infrastructure/firebaseAuthGateway"),
      import("./auth/application/cachedSessionGateway"),
      import("./auth/infrastructure/localStorageSessionStore"),
    ]);
  return withCachedSession(createFirebaseAuthGateway(), localStorageSessionStore);
}

// Decided at build time, so the fake stores are never shipped in a production build.
async function createStoresFactory(): Promise<(userId: string) => UserStores> {
  if (import.meta.env.MODE === "e2e") {
    const [{ createFakeWorkoutLibrary }, { createFakeHistoryLog }] = await Promise.all([
      import("./workouts/infrastructure/fakeWorkoutLibrary"),
      import("./history/infrastructure/fakeHistoryLog"),
    ]);
    return (userId) => ({
      workouts: createFakeWorkoutLibrary(userId),
      history: createFakeHistoryLog(userId),
    });
  }
  const [
    { accountReady, firestore },
    { createLocalStorageOutboxStore },
    { createFirestoreWorkoutLibrary },
    { createFirestoreHistoryLog },
  ] = await Promise.all([
    import("./shared/firebase/firestore"),
    import("./shared/infrastructure/localStorageOutboxStore"),
    import("./workouts/infrastructure/firestoreWorkoutLibrary"),
    import("./history/infrastructure/firestoreHistoryLog"),
  ]);
  // One set per account: two outboxes over the same storage would send the same write twice.
  const stores = new Map<string, UserStores>();
  return (userId) => {
    const existing = stores.get(userId);
    if (existing) return existing;
    const whenReady = () => accountReady(userId);
    const created: UserStores = {
      workouts: createFirestoreWorkoutLibrary(firestore(), userId, {
        store: createLocalStorageOutboxStore(`sportime.outbox.workouts.${userId}`),
        whenReady,
      }),
      history: createFirestoreHistoryLog(firestore(), userId, {
        store: createLocalStorageOutboxStore(`sportime.outbox.history.${userId}`),
        whenReady,
      }),
    };
    stores.set(userId, created);
    return created;
  };
}

const [authGateway, storesFor] = await Promise.all([createAuthGateway(), createStoresFactory()]);

createRoot(root).render(
  <StrictMode>
    <I18nProvider store={localStorageLanguageStore} browserLanguages={navigator.languages}>
      <AuthGate gateway={authGateway}>
        <SignedInApp timer={timer} storesFor={storesFor} account={<AccountMenu />} />
      </AuthGate>
    </I18nProvider>
  </StrictMode>,
);
