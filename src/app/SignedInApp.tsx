import { useMemo, type ReactNode } from "react";
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
}

interface SignedInAppProps {
  timer: TimerDependencies;
  storesFor: (userId: string) => UserStores;
  account?: ReactNode;
}

export function SignedInApp({ timer, storesFor, account }: SignedInAppProps) {
  const { user, reportFailure } = useAuth();
  const stores = useMemo(() => storesFor(user.id), [storesFor, user.id]);
  const deleteAccount = () =>
    stores.deleteAccount().catch((error: unknown) => {
      if (error instanceof AuthFailure && error.kind === "sessionEnded") reportFailure(error.kind);
      throw error;
    });
  // The key drops everything held in memory when the account changes.
  return (
    <App key={user.id} timer={timer} account={account} {...stores} deleteAccount={deleteAccount} />
  );
}
