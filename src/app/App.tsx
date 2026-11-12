import { useState, type ReactNode } from "react";
import { ProfileScreen } from "../account/ui/ProfileScreen";
import { useAccountDeletion } from "../account/ui/useAccountDeletion";
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
  sanitizeConfig,
  type WorkoutConfig,
  type WorkoutMode,
} from "../workouts/domain/workout";
import { SaveWorkoutForm, SavedWorkouts } from "../workouts/ui/SavedWorkouts";
import { WorkoutSetup } from "../workouts/ui/WorkoutSetup";
import styles from "./App.module.css";
import { TabBar, type Tab } from "./TabBar";

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
  deleteAccount: () => Promise<void>;
  deletionConfirmedByRedirect: () => Promise<boolean>;
  account?: ReactNode;
}

/** Settings and Privacy open from Profile, so its tab stays marked while they are shown. */
type Screen = Tab | "settings" | "privacy";

const tabOf = (screen: Screen): Tab =>
  screen === "settings" || screen === "privacy" ? "profile" : screen;

export function App({
  timer,
  workouts,
  history,
  deleteAccount,
  deletionConfirmedByRedirect,
  account,
}: AppProps) {
  const { t, language } = useI18n();
  const [sound, setSound] = useState(() => parseSoundSettings(timer.soundStore.get()));
  const [configs, setConfigs] = useState(initialConfigs);
  const [selectedMode, setSelectedMode] = useState<WorkoutMode>("tabata");
  const [active, setActive] = useState<ActiveWorkout | null>(null);
  const [screen, setScreen] = useState<Screen>("timer");
  const [saveFailure, setSaveFailure] = useState<"workout" | "session" | null>(null);
  const library = useLiveList(workouts.subscribe);
  const deletion = useAccountDeletion({
    onDelete: deleteAccount,
    confirmedByRedirect: deletionConfirmedByRedirect,
    // A deletion resumed after a redirect reports its progress and failures on Profile.
    onResume: () => {
      setScreen("profile");
    },
  });

  const reportWorkoutFailure = () => {
    setSaveFailure("workout");
  };

  /** The selected settings with the round names trimmed, as they are run and stored. */
  const currentConfig = () => sanitizeConfig(selectedMode, configs[selectedMode]);

  const handleStart = () => {
    const config = currentConfig();
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

  const errors = [
    ...(saveFailure === "workout" ? [t.saveFailed] : []),
    ...(saveFailure === "session" ? [t.sessionSaveFailed] : []),
    ...(library.failed ? [t.loadWorkoutsFailed] : []),
  ];

  const openProfile = () => {
    setScreen("profile");
  };

  const content = (() => {
    switch (screen) {
      case "saved":
        return (
          <SavedWorkouts
            workouts={library.failed ? (library.items ?? []) : library.items}
            errors={errors}
            onLoad={({ config }) => {
              setConfigs((current) => ({ ...current, [config.mode]: config }));
              setSelectedMode(config.mode);
              setScreen("timer");
            }}
            onRemove={({ id }) => {
              setSaveFailure(null);
              workouts.remove(id).catch(reportWorkoutFailure);
            }}
          />
        );
      case "history":
        return <HistoryScreen log={history} />;
      case "profile":
        return (
          <ProfileScreen
            account={account}
            deletion={deletion}
            onOpenSettings={() => {
              setScreen("settings");
            }}
            onOpenPrivacy={() => {
              setScreen("privacy");
            }}
          />
        );
      case "settings":
        return (
          <SettingsScreen
            sound={sound}
            voiceAvailable={timer.voice.canSpeak(language)}
            onChangeSound={(next) => {
              setSound(next);
              timer.soundStore.set(next);
            }}
            onBack={openProfile}
          />
        );
      case "privacy":
        return <PrivacyScreen onBack={openProfile} />;
      case "timer":
        return (
          <WorkoutSetup
            config={configs[selectedMode]}
            onSelectMode={setSelectedMode}
            onChange={(config) => {
              setConfigs((current) => ({ ...current, [config.mode]: config }));
            }}
            onStart={handleStart}
            saveForm={
              <SaveWorkoutForm
                errors={errors}
                onSave={(name) => {
                  setSaveFailure(null);
                  // Not awaited: the server never answers offline, and the write is already queued.
                  workouts
                    .save({ name, config: currentConfig(), createdAt: timer.clock.now() })
                    .catch(reportWorkoutFailure);
                }}
              />
            }
          />
        );
    }
  })();

  return (
    <div className={styles.withTabs}>
      {content}
      <TabBar current={tabOf(screen)} onSelect={setScreen} />
    </div>
  );
}
