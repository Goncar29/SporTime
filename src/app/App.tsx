import { useState, type ReactNode } from "react";
import type { HistoryLog } from "../history/application/ports";
import { recordFinishedSessions } from "../history/application/recordFinishedSessions";
import { HistoryScreen } from "../history/ui/HistoryScreen";
import { useI18n } from "../i18n/ui/I18nProvider";
import { useLiveList } from "../shared/ui/useLiveList";
import type { Clock, CuePlayer, ScreenAwake } from "../timer/application/ports";
import { createTimerController, type TimerController } from "../timer/application/timerController";
import { TimerScreen } from "../timer/ui/TimerScreen";
import type { WorkoutLibrary } from "../workouts/application/ports";
import { buildTimeline, type Timeline } from "../workouts/domain/timeline";
import {
  MODES,
  defaultConfig,
  type WorkoutConfig,
  type WorkoutMode,
} from "../workouts/domain/workout";
import { SavedWorkouts } from "../workouts/ui/SavedWorkouts";
import { WorkoutSetup } from "../workouts/ui/WorkoutSetup";

export interface TimerDependencies {
  clock: Clock;
  cues: CuePlayer;
  screenAwake: ScreenAwake;
}

interface ActiveWorkout {
  mode: WorkoutMode;
  timeline: Timeline;
  controller: TimerController;
}

const initialConfigs = () =>
  Object.fromEntries(MODES.map(({ id }) => [id, defaultConfig(id)])) as Record<
    WorkoutMode,
    WorkoutConfig
  >;

interface AppProps {
  timer: TimerDependencies;
  workouts: WorkoutLibrary;
  history: HistoryLog;
  account?: ReactNode;
}

export function App({ timer, workouts, history, account }: AppProps) {
  const { t } = useI18n();
  const [configs, setConfigs] = useState(initialConfigs);
  const [selectedMode, setSelectedMode] = useState<WorkoutMode>("tabata");
  const [active, setActive] = useState<ActiveWorkout | null>(null);
  const [showingHistory, setShowingHistory] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const library = useLiveList(workouts.subscribe);

  const reportSaveFailure = () => {
    setSaveFailed(true);
  };

  const handleStart = () => {
    const config = configs[selectedMode];
    const timeline = buildTimeline(config);
    const controller = createTimerController({ timeline, ...timer });
    recordFinishedSessions({
      controller,
      config,
      log: history,
      clock: timer.clock,
      onFailure: reportSaveFailure,
    });
    // Started inside the click handler because browsers only unlock audio during a user gesture.
    controller.start();
    setActive({ mode: selectedMode, timeline, controller });
  };

  const handleExit = () => {
    active?.controller.dispose();
    setActive(null);
  };

  if (active) {
    return (
      <TimerScreen
        mode={active.mode}
        timeline={active.timeline}
        controller={active.controller}
        onExit={handleExit}
      />
    );
  }

  if (showingHistory) {
    return (
      <HistoryScreen
        log={history}
        onBack={() => {
          setShowingHistory(false);
        }}
      />
    );
  }

  const errors = [
    ...(saveFailed ? [t.saveFailed] : []),
    ...(library.failed ? [t.loadWorkoutsFailed] : []),
  ];

  return (
    <WorkoutSetup
      config={configs[selectedMode]}
      onSelectMode={setSelectedMode}
      onChange={(config) => {
        setConfigs((current) => ({ ...current, [config.mode]: config }));
      }}
      onStart={handleStart}
      library={
        <SavedWorkouts
          workouts={library.failed ? (library.items ?? []) : library.items}
          errors={errors}
          onSave={(name) => {
            setSaveFailed(false);
            // Not awaited: the server never answers offline, and the write is already queued.
            workouts
              .save({ name, config: configs[selectedMode], createdAt: timer.clock.now() })
              .catch(reportSaveFailure);
          }}
          onLoad={({ config }) => {
            setConfigs((current) => ({ ...current, [config.mode]: config }));
            setSelectedMode(config.mode);
          }}
          onRemove={({ id }) => {
            setSaveFailed(false);
            workouts.remove(id).catch(reportSaveFailure);
          }}
          onOpenHistory={() => {
            setShowingHistory(true);
          }}
        />
      }
      account={account}
    />
  );
}
