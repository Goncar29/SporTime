import { useMemo, type ReactNode } from "react";
import type { SignOutOptions, SignOutResult } from "../account/application/signOut";
import { useSignOut, type AccountSignOut } from "../account/ui/useSignOut";
import { AuthFailure } from "../auth/domain/user";
import { useAuth } from "../auth/ui/AuthGate";
import type { HistoryLog } from "../history/application/ports";
import type { WorkoutLibrary } from "../workouts/application/ports";
import { App, type TimerDependencies } from "./App";

export interface UserStores {
  workouts: WorkoutLibrary;
  history: HistoryLog;
  deleteAccount: () => Promise<void>;
  deletionConfirmedByRedirect: () => Promise<boolean>;
  /** Sends what is pending, then signs out and erases this device's copy of the account. */
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>;
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
  const signOut = useSignOut({ signOut: (options) => stores.signOut(options), reload });
  const deleteAccount = () =>
    stores.deleteAccount().catch((error: unknown) => {
      if (error instanceof AuthFailure && error.kind === "sessionEnded") reportFailure(error.kind);
      throw error;
    });
  // The key drops everything held in memory when the account changes.
  return (
    <App
      key={user.id}
      timer={timer}
      account={account?.(signOut)}
      workouts={stores.workouts}
      history={stores.history}
      deleteAccount={deleteAccount}
      deletionConfirmedByRedirect={stores.deletionConfirmedByRedirect}
    />
  );
}
