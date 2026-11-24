import { useMemo, type ReactNode } from "react";
import type { OtherTabsActivity } from "../account/application/ports";
import type { SignOutOptions, SignOutResult } from "../account/application/signOut";
import { useOtherTabs } from "../account/ui/useOtherTabs";
import { useSignOut, type AccountSignOut } from "../account/ui/useSignOut";
import { AuthFailure, type User } from "../auth/domain/user";
import { useAuth } from "../auth/ui/AuthGate";
import type { ContactList } from "../contacts/application/ports";
import type { DirectoryListing } from "../directory/application/ports";
import type { HistoryLog } from "../history/application/ports";
import type { RoutineLibrary } from "../routines/application/ports";
import type { WorkoutLibrary } from "../workouts/application/ports";
import { App, type TimerDependencies } from "./App";

export interface UserStores {
  workouts: WorkoutLibrary;
  history: HistoryLog;
  routines: RoutineLibrary;
  /** Who the user keeps as contacts; erased with the account and from this device on sign-out. */
  contacts: ContactList;
  /**
   * Whether the signed-in user can be found by email, which needs their Google profile; none
   * where the directory is not offered.
   */
  directoryFor?: (user: User) => DirectoryListing;
  deleteAccount: () => Promise<void>;
  deletionConfirmedByRedirect: () => Promise<boolean>;
  /** Sends what is pending, then signs out and erases this device's copy of the account. */
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>;
  /** What the account's other open tabs are doing; none where tabs cannot be told apart. */
  otherTabs?: OtherTabsActivity;
}

interface SignedInAppProps {
  timer: TimerDependencies;
  storesFor: (userId: string) => UserStores;
  /** Who is signed in, with the sign-out button driven by `signOut`. */
  account?: (signOut: AccountSignOut) => ReactNode;
  reload?: () => void;
}

const reloadPage = () => {
  location.reload();
};

export function SignedInApp({ timer, storesFor, account, reload = reloadPage }: SignedInAppProps) {
  const { user, reportFailure } = useAuth();
  const stores = useMemo(() => storesFor(user.id), [storesFor, user.id]);
  const { id, name, email, photoUrl } = user;
  const directory = useMemo(
    () => stores.directoryFor?.({ id, name, email, photoUrl }),
    [stores, id, name, email, photoUrl],
  );
  const signOut = useSignOut({ signOut: (options) => stores.signOut(options), reload });
  const otherTabs = useOtherTabs(stores.otherTabs);
  const deleteAccount = () =>
    stores.deleteAccount().then(
      // Its other tabs were told the account is gone, and so was this page, which would refuse
      // every later change, even of another account signed in here: start afresh.
      reload,
      (error: unknown) => {
        if (error instanceof AuthFailure && error.kind === "sessionEnded") {
          reportFailure(error.kind);
        }
        throw error;
      },
    );
  // The key drops everything held in memory when the account changes.
  return (
    <App
      key={user.id}
      timer={timer}
      account={account?.(signOut)}
      signingOut={signOut.signingOut}
      otherTabs={otherTabs}
      workouts={stores.workouts}
      history={stores.history}
      routines={stores.routines}
      directory={directory}
      deleteAccount={deleteAccount}
      deletionConfirmedByRedirect={stores.deletionConfirmedByRedirect}
    />
  );
}
