import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { AppUpdater } from "../application/appUpdater";

/** Without a provider, as in most tests, there is no new version to hold back. */
const UpdateContext = createContext<AppUpdater | null>(null);

interface UpdateProviderProps {
  updater: AppUpdater;
  children: ReactNode;
}

export function UpdateProvider({ updater, children }: UpdateProviderProps) {
  return <UpdateContext.Provider value={updater}>{children}</UpdateContext.Provider>;
}

/** Holds a new version of the app back while `busy`, so its reload never cuts it short. */
export function useHoldUpdates(busy: boolean) {
  const updater = useContext(UpdateContext);
  useEffect(() => {
    updater?.setBusy(busy);
    return () => {
      updater?.setBusy(false);
    };
  }, [updater, busy]);
}
