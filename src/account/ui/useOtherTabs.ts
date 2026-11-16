import { useCallback, useSyncExternalStore } from "react";
import type { OtherTabsActivity, OtherTabsStatus } from "../application/ports";

/** What the account's other open tabs are doing; "idle" when there is nothing to watch. */
export function useOtherTabs(otherTabs: OtherTabsActivity | undefined): OtherTabsStatus {
  const subscribe = useCallback(
    (listener: () => void) => otherTabs?.subscribe(listener) ?? (() => undefined),
    [otherTabs],
  );
  return useSyncExternalStore(subscribe, () => otherTabs?.get() ?? "idle");
}
