import { useMemo, type ReactNode } from "react";
import { useAuth } from "../auth/ui/AuthGate";
import type { HistoryLog } from "../history/application/ports";
import type { WorkoutLibrary } from "../workouts/application/ports";
import { App, type TimerDependencies } from "./App";

export interface UserStores {
  workouts: WorkoutLibrary;
  history: HistoryLog;
}

interface SignedInAppProps {
  timer: TimerDependencies;
  storesFor(userId: string): UserStores;
  account?: ReactNode;
}

export function SignedInApp({ timer, storesFor, account }: SignedInAppProps) {
  const { user } = useAuth();
  const stores = useMemo(() => storesFor(user.id), [storesFor, user.id]);
  // The key drops everything held in memory when the account changes.
  return <App key={user.id} timer={timer} account={account} {...stores} />;
}
