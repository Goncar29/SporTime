import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import type { InstallController, InstallDismissals } from "../application/ports";
import { shouldOfferInstall, type InstallState } from "../domain/install";

interface Install {
  state: InstallState;
  /** True while the notice should show: installable and not dismissed in the last 30 days. */
  offered: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
}

/** Without a provider, as in most tests, there is nothing to install. */
const InstallContext = createContext<Install>({
  state: "unavailable",
  offered: false,
  install: () => Promise.resolve(),
  dismiss: () => undefined,
});

interface InstallProviderProps {
  controller: InstallController;
  dismissals: InstallDismissals;
  now?: () => number;
  children: ReactNode;
}

export function InstallProvider({
  controller,
  dismissals,
  now = Date.now,
  children,
}: InstallProviderProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.state);
  const [dismissedAt, setDismissedAt] = useState(() => dismissals.get());

  const value: Install = {
    state,
    offered: shouldOfferInstall(state, dismissedAt, now()),
    async install() {
      try {
        await controller.install();
      } catch (error) {
        // The offer is gone either way; the browser offers again on a later visit.
        console.error("The install dialog could not open:", error);
      }
    },
    dismiss() {
      const at = now();
      dismissals.set(at);
      setDismissedAt(at);
    },
  };

  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export const useInstall = () => useContext(InstallContext);
