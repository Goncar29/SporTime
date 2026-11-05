import { useState, type ReactNode } from "react";
import { DeleteAccountScreen } from "../account/ui/DeleteAccountScreen";
import { PrivacyScreen } from "../account/ui/PrivacyScreen";
import { SettingsScreen } from "../settings/ui/SettingsScreen";
import type { HistoryLog } from "../history/application/ports";
import { recordFinishedSessions } from "../history/application/recordFinishedSessions";
import { HistoryScreen } from "../history/ui/HistoryScreen";
import { useI18n } from "../i18n/ui/I18nProvider";
import { useLiveList } from "../shared/ui/useLiveList";
import type {
  Announcer,
  Clock,
  CuePlayer,
  ScreenAwake,
  SoundSettingsStore,
  VoicePlayer,
} from "../timer/application/ports";
import { createTimerController, type TimerController } from "../timer/application/timerController";
import { parseSoundSettings } from "../timer/domain/soundSettings";
import { TimerScreen } from "../timer/ui/TimerScreen";
import { spokenPhrase } from "../timer/ui/spokenPhrase";
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
import styles from "./App.module.css";

export interface TimerDependencies {
  clock: Clock;
  cues: CuePlayer;
  voice: VoicePlayer;
  soundStore: SoundSettingsStore;
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
  deleteAccount(): Promise<void>;
  account?: ReactNode;
}

type Screen = "setup" | "history" | "settings" | "privacy" | "deleteAccount";

export function App({ timer, workouts, history, deleteAccount, account }: AppProps) {
  const { t, language } = useI18n();
  const [sound, setSound] = useState(() => parseSoundSettings(timer.soundStore.get()));
  const [configs, setConfigs] = useState(initialConfigs);
  const [selectedMode, setSelectedMode] = useState<WorkoutMode>("tabata");
  const [active, setActive] = useState<ActiveWorkout | null>(null);
  const [screen, setScreen] = useState<Screen>("setup");
  const [saveFailure, setSaveFailure] = useState<"workout" | "session" | null>(null);
  const library = useLiveList(workouts.subscribe);

  const reportWorkoutFailure = () => {
    setSaveFailure("workout");
  };

  const handleStart = () => {
    const config = configs[selectedMode];
    const timeline = buildTimeline(config);
    const voice: Announcer = {
      unlock: () => {
        timer.voice.unlock();
      },
      canSpeak: () => timer.voice.canSpeak(language),
      say: (announcement) => {
        timer.voice.say(spokenPhrase(t, announcement), language);
      },
    };
    const controller = createTimerController({
      timeline,
      clock: timer.clock,
      cues: timer.cues,
      screenAwake: timer.screenAwake,
      voice,
      sound,
    });
    recordFinishedSessions({
      controller,
      config,
      log: history,
      clock: timer.clock,
      onFailure() {
        setSaveFailure("session");
      },
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

  const backToSetup = () => {
    setScreen("setup");
  };

  if (screen === "history") return <HistoryScreen log={history} onBack={backToSetup} />;
  if (screen === "settings") {
    return (
      <SettingsScreen
        sound={sound}
        voiceAvailable={timer.voice.canSpeak(language)}
        onChangeSound={(next) => {
          setSound(next);
          timer.soundStore.set(next);
        }}
        onBack={backToSetup}
      />
    );
  }
  if (screen === "privacy") return <PrivacyScreen onBack={backToSetup} />;
  if (screen === "deleteAccount") {
    return <DeleteAccountScreen onDelete={deleteAccount} onBack={backToSetup} />;
  }

  const errors = [
    ...(saveFailure === "workout" ? [t.saveFailed] : []),
    ...(saveFailure === "session" ? [t.sessionSaveFailed] : []),
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
            setSaveFailure(null);
            // Not awaited: the server never answers offline, and the write is already queued.
            workouts
              .save({ name, config: configs[selectedMode], createdAt: timer.clock.now() })
              .catch(reportWorkoutFailure);
          }}
          onLoad={({ config }) => {
            setConfigs((current) => ({ ...current, [config.mode]: config }));
            setSelectedMode(config.mode);
          }}
          onRemove={({ id }) => {
            setSaveFailure(null);
            workouts.remove(id).catch(reportWorkoutFailure);
          }}
          onOpenHistory={() => {
            setScreen("history");
          }}
        />
      }
      account={
        <>
          {account}
          <nav className={styles.links}>
            <button
              className={styles.link}
              onClick={() => {
                setScreen("settings");
              }}
            >
              {t.settings}
            </button>
            <button
              className={styles.link}
              onClick={() => {
                setScreen("privacy");
              }}
            >
              {t.privacy}
            </button>
            <button
              className={styles.link}
              onClick={() => {
                setScreen("deleteAccount");
              }}
            >
              {t.deleteAccount}
            </button>
          </nav>
        </>
      }
    />
  );
}
