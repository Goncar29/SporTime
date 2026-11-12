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
import type { HistoryDraft } from "./history/domain/historyEntry";
import { localStorageLanguageStore } from "./i18n/infrastructure/localStorageLanguageStore";
import { I18nProvider } from "./i18n/ui/I18nProvider";
import {
  createBrowserInstall,
  localStorageInstallDismissals,
} from "./install/infrastructure/browserInstall";
import { InstallProvider } from "./install/ui/InstallProvider";
import type { SavedWorkoutDraft } from "./workouts/domain/savedWorkout";
import { localStorageSoundSettingsStore } from "./timer/infrastructure/localStorageSoundSettingsStore";
import {
  createSystemVoice,
  createWakeLockScreenAwake,
  createWebAudioCuePlayer,
  systemClock,
} from "./timer/infrastructure/browserTimerAdapters";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

// Before any await below: the browser may offer the install while the rest still loads.
const install = createBrowserInstall();

const timer = {
  clock: systemClock,
  cues: createWebAudioCuePlayer(),
  voice: createSystemVoice(),
  soundStore: localStorageSoundSettingsStore,
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
async function createStoresFactory(
  authGateway: AuthGateway,
): Promise<(userId: string) => UserStores> {
  if (import.meta.env.MODE === "e2e") {
    const [{ createFakeWorkoutLibrary }, { createFakeHistoryLog }] = await Promise.all([
      import("./workouts/infrastructure/fakeWorkoutLibrary"),
      import("./history/infrastructure/fakeHistoryLog"),
    ]);
    return (userId) => ({
      workouts: createFakeWorkoutLibrary(userId),
      history: createFakeHistoryLog(userId),
      deleteAccount: () => authGateway.signOut(),
      deletionConfirmedByRedirect: () => Promise.resolve(false),
    });
  }
  const [
    { accountReady, firestore },
    { createLocalStorageOutboxStore },
    { createFirestoreWorkoutLibrary },
    { createFirestoreHistoryLog },
    { deleteAccount },
    { createFirebaseAccountIdentity },
    { createFirestoreAccountData },
  ] = await Promise.all([
    import("./shared/firebase/firestore"),
    import("./shared/infrastructure/localStorageOutboxStore"),
    import("./workouts/infrastructure/firestoreWorkoutLibrary"),
    import("./history/infrastructure/firestoreHistoryLog"),
    import("./account/application/deleteAccount"),
    import("./account/infrastructure/firebaseAccountIdentity"),
    import("./account/infrastructure/firestoreAccountData"),
  ]);
  // One set per account: two outboxes over the same storage would send the same write twice.
  const stores = new Map<string, UserStores>();
  return (userId) => {
    const existing = stores.get(userId);
    if (existing) return existing;
    const whenReady = () => accountReady(userId);
    const workoutOutbox = createLocalStorageOutboxStore<SavedWorkoutDraft>(
      `sportime.outbox.workouts.${userId}`,
    );
    const historyOutbox = createLocalStorageOutboxStore<HistoryDraft>(
      `sportime.outbox.history.${userId}`,
    );
    const discardPendingWrites = () => {
      workoutOutbox.save([]);
      historyOutbox.save([]);
    };
    const identity = createFirebaseAccountIdentity(userId);
    const created: UserStores = {
      workouts: createFirestoreWorkoutLibrary(firestore(), userId, {
        store: workoutOutbox,
        whenReady,
      }),
      history: createFirestoreHistoryLog(firestore(), userId, { store: historyOutbox, whenReady }),
      deleteAccount: () =>
        deleteAccount({
          identity,
          data: createFirestoreAccountData({
            db: firestore(),
            userId,
            discardPendingWrites,
          }),
        }),
      deletionConfirmedByRedirect: () => identity.confirmedByRedirect(),
    };
    stores.set(userId, created);
    return created;
  };
}

// Decided at build time, so this is never shipped in a production build.
if (import.meta.env.MODE === "emulator") {
  const { connectToEmulators } = await import("./shared/firebase/emulators");
  connectToEmulators();
}

const authGateway = await createAuthGateway();
const storesFor = await createStoresFactory(authGateway);

createRoot(root).render(
  <StrictMode>
    <I18nProvider store={localStorageLanguageStore} browserLanguages={navigator.languages}>
      <InstallProvider controller={install} dismissals={localStorageInstallDismissals}>
        <AuthGate gateway={authGateway}>
          <SignedInApp timer={timer} storesFor={storesFor} account={<AccountMenu />} />
        </AuthGate>
      </InstallProvider>
    </I18nProvider>
  </StrictMode>,
);
