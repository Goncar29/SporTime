import { useState, type ReactNode } from "react";
import type { Clock, CuePlayer, ScreenAwake } from "../timer/application/ports";
import { createTimerController, type TimerController } from "../timer/application/timerController";
import { TimerScreen } from "../timer/ui/TimerScreen";
import { buildTimeline, type Timeline } from "../workouts/domain/timeline";
import {
  MODES,
  defaultConfig,
  type WorkoutConfig,
  type WorkoutMode,
} from "../workouts/domain/workout";
import { WorkoutSetup } from "../workouts/ui/WorkoutSetup";

interface TimerDependencies {
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
  account?: ReactNode;
}

export function App({ timer, account }: AppProps) {
  const [configs, setConfigs] = useState(initialConfigs);
  const [selectedMode, setSelectedMode] = useState<WorkoutMode>("tabata");
  const [active, setActive] = useState<ActiveWorkout | null>(null);

  const handleStart = () => {
    const timeline = buildTimeline(configs[selectedMode]);
    const controller = createTimerController({ timeline, ...timer });
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

  return (
    <WorkoutSetup
      config={configs[selectedMode]}
      onSelectMode={setSelectedMode}
      onChange={(config) => {
        setConfigs((current) => ({ ...current, [config.mode]: config }));
      }}
      onStart={handleStart}
      account={account}
    />
  );
}
