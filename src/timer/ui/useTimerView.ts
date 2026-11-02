import { useEffect, useSyncExternalStore } from "react";
import type { TimerController, TimerView } from "../application/timerController";

const TICK_MS = 100;

export function useTimerView(controller: TimerController): TimerView {
  useEffect(() => {
    const interval = setInterval(controller.tick, TICK_MS);
    // Timers are throttled in the background, so catch up as soon as we return.
    document.addEventListener("visibilitychange", controller.tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", controller.tick);
    };
  }, [controller]);

  return useSyncExternalStore(controller.subscribe, controller.getView);
}
