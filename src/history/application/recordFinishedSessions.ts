import type { Clock } from "../../timer/application/ports";
import type { TimerController } from "../../timer/application/timerController";
import type { WorkoutConfig } from "../../workouts/domain/workout";
import { createHistoryDraft } from "../domain/historyEntry";
import type { HistoryLog } from "./ports";

interface Dependencies {
  controller: TimerController;
  config: WorkoutConfig;
  log: Pick<HistoryLog, "add">;
  clock: Clock;
  onFailure: (error: unknown) => void;
}

/** Only finished sessions reach the history: leaving a workout early records nothing. */
export function recordFinishedSessions({
  controller,
  config,
  log,
  clock,
  onFailure,
}: Dependencies): void {
  let lastStatus = controller.getView().status;
  controller.subscribe(() => {
    const view = controller.getView();
    if (view.status === "finished" && lastStatus !== "finished") {
      const draft = createHistoryDraft({
        config,
        activeElapsedMs: view.activeElapsedMs,
        markCount: view.marks.length,
        now: clock.now(),
      });
      log.add(draft).catch(onFailure);
    }
    lastStatus = view.status;
  });
}
