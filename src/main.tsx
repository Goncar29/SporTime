import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-800-italic.css";
import "./app/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  createSignOutSignal,
  createSigningOutSignal,
} from "./account/infrastructure/signOutSignal";
import { SignedInApp, type UserStores } from "./app/SignedInApp";
import { markedForClearing } from "./shared/firebase/clearOnStart";
import { StoresLoader, createStoresLoad } from "./app/StoresLoader";
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
import type { RoutineDraft } from "./routines/domain/routine";
import { startBrowserUpdates } from "./update/infrastructure/browserUpdates";
import { UpdateProvider } from "./update/ui/UpdateProvider";
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
// Also before any await: a broken start-up must still be able to receive the fixed version.
const updates = startBrowserUpdates();

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
  const [
    { createFirebaseAuthGateway, firebaseRedirectPending },
    { withCachedSession },
    { localStorageSessionStore },
  ] = await Promise.all([
    import("./auth/infrastructure/firebaseAuthGateway"),
    import("./auth/application/cachedSessionGateway"),
    import("./auth/infrastructure/localStorageSessionStore"),
  ]);
  return withCachedSession(
    createFirebaseAuthGateway(),
    localStorageSessionStore,
    firebaseRedirectPending,
  );
}

const reloadPage = () => {
  location.reload();
};

// Another tab's sign-out stops this tab's Firestore and erases its outbox, so start afresh.
const signOutSignal = createSignOutSignal();
const signingOutSignal = createSigningOutSignal();
// Once an account's stores exist, they decide, since a change waiting there must be explained first.
let reloadsOnSignOutElsewhere = true;
signOutSignal.subscribe(() => {
  if (reloadsOnSignOutElsewhere) reloadPage();
});

// Decided at build time, so the fake stores are never shipped in a production build.
async function createStoresFactory(
  authGateway: AuthGateway,
): Promise<(userId: string) => UserStores> {
  const { signOut } = await import("./account/application/signOut");
  // Told right after the provider signs out, before erasing, which other tabs must not hold up.
  const auth = {
    async signOut() {
      await authGateway.signOut();
      signOutSignal.announce();
    },
  };
  if (import.meta.env.MODE === "e2e") {
    const [{ createFakeWorkoutLibrary }, { createFakeHistoryLog }, { createFakeRoutineLibrary }] =
      await Promise.all([
        import("./workouts/infrastructure/fakeWorkoutLibrary"),
        import("./history/infrastructure/fakeHistoryLog"),
        import("./routines/infrastructure/fakeRoutineLibrary"),
      ]);
    // No Firestore here: nothing waits to be sent and nothing is cached, so sign-out stays as it was.
    const local = {
      sendPending: () => Promise.resolve("sent" as const),
      discardPending: () => undefined,
      eraseOnNextStart: () => undefined,
      keepOnNextStart: () => undefined,
      erase: () => Promise.resolve(),
    };
    return (userId) => ({
      workouts: createFakeWorkoutLibrary(userId),
      history: createFakeHistoryLog(userId),
      routines: createFakeRoutineLibrary(userId),
      deleteAccount: () => authGateway.signOut(),
      deletionConfirmedByRedirect: () => Promise.resolve(false),
      signOut: (options) => signOut({ auth, local }, options),
    });
  }
  const [
    {
      accountReady,
      clearLocalCache,
      firestore,
      markForClearing,
      serverHasWrites,
      unmarkForClearing,
    },
    { createLocalStorageOutboxStore },
    { createFirestoreWorkoutLibrary },
    { createFirestoreHistoryLog },
    { createFirestoreRoutineLibrary },
    { deleteAccount },
    { createFirebaseAccountIdentity },
    { createFirestoreAccountData },
    { createLocalAccountData },
    { browserLocks, createAccountLock },
    { createOtherTabs },
  ] = await Promise.all([
    import("./shared/firebase/firestore"),
    import("./shared/infrastructure/localStorageOutboxStore"),
    import("./workouts/infrastructure/firestoreWorkoutLibrary"),
    import("./history/infrastructure/firestoreHistoryLog"),
    import("./routines/infrastructure/firestoreRoutineLibrary"),
    import("./account/application/deleteAccount"),
    import("./account/infrastructure/firebaseAccountIdentity"),
    import("./account/infrastructure/firestoreAccountData"),
    import("./account/infrastructure/localAccountData"),
    import("./account/infrastructure/accountLock"),
    import("./account/infrastructure/otherTabs"),
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
    const routineOutbox = createLocalStorageOutboxStore<RoutineDraft>(
      `sportime.outbox.routines.${userId}`,
    );
    const discardPendingWrites = () => {
      workoutOutbox.save([]);
      historyOutbox.save([]);
      routineOutbox.save([]);
    };
    const identity = createFirebaseAccountIdentity(userId);
    // Changes wait while another tab signs out, and are refused once it did (or none without Web Locks).
    const otherTabs = createOtherTabs({
      lock: createAccountLock(userId, browserLocks()),
      signedOut: signOutSignal,
      signingOut: signingOutSignal,
      reload: reloadPage,
    });
    reloadsOnSignOutElsewhere = false;
    // Each change is followed until the server answers: a sign-out elsewhere that drops one
    // must say so here.
    const workoutLibrary = createFirestoreWorkoutLibrary(firestore(), userId, {
      store: workoutOutbox,
      whenReady,
      guard: otherTabs.guard,
    });
    const workouts = {
      ...workoutLibrary,
      save: (draft: SavedWorkoutDraft) => otherTabs.confirming(workoutLibrary.save(draft)),
      update: (workout: Parameters<typeof workoutLibrary.update>[0]) =>
        otherTabs.confirming(workoutLibrary.update(workout)),
      remove: (id: string) => otherTabs.confirming(workoutLibrary.remove(id)),
    };
    const historyLog = createFirestoreHistoryLog(firestore(), userId, {
      store: historyOutbox,
      whenReady,
      guard: otherTabs.guard,
    });
    const history = {
      ...historyLog,
      add: (draft: HistoryDraft) => otherTabs.confirming(historyLog.add(draft)),
      remove: (id: string) => otherTabs.confirming(historyLog.remove(id)),
    };
    const routineLibrary = createFirestoreRoutineLibrary(firestore(), userId, {
      store: routineOutbox,
      whenReady,
      guard: otherTabs.guard,
    });
    const routines = {
      ...routineLibrary,
      save: (draft: RoutineDraft) => otherTabs.confirming(routineLibrary.save(draft)),
      update: (routine: Parameters<typeof routineLibrary.update>[0]) =>
        otherTabs.confirming(routineLibrary.update(routine)),
      remove: (id: string) => otherTabs.confirming(routineLibrary.remove(id)),
    };
    const local = createLocalAccountData({
      outboxes: [workouts, history, routines],
      discardPendingWrites,
      serverHasWrites,
      clearCache: clearLocalCache,
      forget: () => {
        stores.delete(userId);
      },
      clearOnNextStart: { mark: markForClearing, unmark: unmarkForClearing },
    });
    // Once the account is gone, its other tabs are told, as after a sign-out: a change waiting
    // there is refused and explained, and the rest go to sign-in.
    const removing = {
      isRecentlyConfirmed: () => identity.isRecentlyConfirmed(),
      confirm: () => identity.confirm(),
      confirmedByRedirect: () => identity.confirmedByRedirect(),
      async remove() {
        await identity.remove();
        signOutSignal.announce("deletion");
      },
    };
    const created: UserStores = {
      workouts,
      history,
      routines,
      // Holds every change, here and in the other tabs, from erasing until the account is gone.
      deleteAccount: () =>
        deleteAccount({
          identity: removing,
          data: createFirestoreAccountData({
            db: firestore(),
            userId,
            discardPendingWrites,
          }),
          otherTabs,
        }),
      deletionConfirmedByRedirect: () => identity.confirmedByRedirect(),
      // Holds the other tabs' changes from the send until erasing ends.
      signOut: (options) => signOut({ auth, local, otherTabs }, options),
      otherTabs,
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

// A sign-out cut short (page closed, or reloaded) left the account's copy on this device: clear
// it now, before anyone signs in, rather than on the next sign-in.
if (import.meta.env.MODE !== "e2e" && markedForClearing()) {
  void import("./shared/firebase/firestore").then(({ firestore }) => firestore());
}

// Loaded once someone is signed in, not before the first paint: the sign-in screen needs no Firestore.
const storesFactory = createStoresLoad(() => createStoresFactory(authGateway));

createRoot(root).render(
  <StrictMode>
    <I18nProvider store={localStorageLanguageStore} browserLanguages={navigator.languages}>
      <InstallProvider controller={install} dismissals={localStorageInstallDismissals}>
        <UpdateProvider updater={updates}>
          <AuthGate gateway={authGateway}>
            <StoresLoader load={storesFactory}>
              {(storesFor) => (
                <SignedInApp
                  timer={timer}
                  storesFor={storesFor}
                  account={(signOut) => <AccountMenu signOut={signOut} />}
                />
              )}
            </StoresLoader>
          </AuthGate>
        </UpdateProvider>
      </InstallProvider>
    </I18nProvider>
  </StrictMode>,
);
