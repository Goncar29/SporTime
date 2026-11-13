import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProfileScreen } from "../account/ui/ProfileScreen";
import { useAccountDeletion } from "../account/ui/useAccountDeletion";
import { PrivacyScreen } from "../account/ui/PrivacyScreen";
import { SettingsScreen } from "../settings/ui/SettingsScreen";
import type { HistoryLog } from "../history/application/ports";
import { recordFinishedSessions } from "../history/application/recordFinishedSessions";
import { HistoryScreen } from "../history/ui/HistoryScreen";
import { useI18n } from "../i18n/ui/I18nProvider";
import type { StoreFailureKind } from "../shared/domain/storeFailure";
import { reportStoreFailure, storeFailureMessage } from "../shared/ui/storeFailure";
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
import type { SavedWorkout } from "../workouts/domain/savedWorkout";
import { buildTimeline, type Timeline } from "../workouts/domain/timeline";
import {
  MODES,
  defaultConfig,
  sameConfig,
  sanitizeConfig,
  type WorkoutConfig,
  type WorkoutMode,
} from "../workouts/domain/workout";
import { InstallBanner } from "../install/ui/InstallBanner";
import { EditingNotice, SaveWorkoutForm, SavedWorkouts } from "../workouts/ui/SavedWorkouts";
import { WorkoutSetup } from "../workouts/ui/WorkoutSetup";
import { useHoldUpdates } from "../update/ui/UpdateProvider";
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
  const [saveFailure, setSaveFailure] = useState<{
    what: "workout" | "session";
    kind: StoreFailureKind;
  } | null>(null);
  const library = useLiveList(workouts.subscribe, "Loading saved workouts");
  const [editing, setEditing] = useState<SavedWorkout | null>(null);
  // Deleted meanwhile, here or on another device: there is nothing left to save changes to.
  const editingWorkout =
    editing && (library.items === null || library.items.some(({ id }) => id === editing.id))
      ? editing
      : null;
  // A refused save puts its name back in the form; the version remounts the form to show it.
  const [recoveredName, setRecoveredName] = useState<string | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  // Read when a refusal arrives, possibly long after the save if it was queued offline.
  const timerNow = useRef<{ editing: SavedWorkout | null; settings: WorkoutConfig | null }>({
    editing,
    settings: null,
  });
  useEffect(() => {
    timerNow.current = {
      editing,
      settings: sanitizeConfig(selectedMode, configs[selectedMode]),
    };
  }, [editing, selectedMode, configs]);
  // A new version of the app reloads the page, which would stop a running workout.
  useHoldUpdates(active !== null);
  const deletion = useAccountDeletion({
    onDelete: deleteAccount,
    confirmedByRedirect: deletionConfirmedByRedirect,
    // A deletion resumed after a redirect reports its progress and failures on Profile.
    onResume: () => {
      setScreen("profile");
    },
  });

  /** Returns the handler for one operation, so the developer's log names what failed. */
  const reportWorkoutFailure = (operation: string) => (error: unknown) => {
    setSaveFailure({ what: "workout", kind: reportStoreFailure(operation, error) });
  };

  /**
   * Puts a refused edit back on the Timer, unless the Timer has moved on since the save:
   * another edit started, or its settings changed. The refusal message shows either way.
   */
  const restoreRefusedEdit = (workout: SavedWorkout, name: string, config: WorkoutConfig) => {
    const now = timerNow.current;
    if (now.editing !== null || now.settings === null || !sameConfig(now.settings, config)) return;
    setConfigs((current) => ({ ...current, [config.mode]: config }));
    setSelectedMode(config.mode);
    setEditing(workout);
    setRecoveredName(name);
    setFormVersion((version) => version + 1);
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
      onFailure(error) {
        setSaveFailure({
          what: "session",
          kind: reportStoreFailure("Saving a finished session", error),
        });
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
    ...(saveFailure
      ? [
          storeFailureMessage(
            t,
            saveFailure.kind,
            saveFailure.what === "workout" ? t.saveFailed : t.sessionSaveFailed,
          ),
        ]
      : []),
    ...(library.failed
      ? [storeFailureMessage(t, library.failure ?? "unknown", t.loadWorkoutsFailed)]
      : []),
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
              setEditing(null);
              setRecoveredName(null);
              setScreen("timer");
            }}
            onEdit={(workout) => {
              const { config } = workout;
              setConfigs((current) => ({ ...current, [config.mode]: config }));
              setSelectedMode(config.mode);
              setEditing(workout);
              setRecoveredName(null);
              setScreen("timer");
            }}
            onRemove={({ id }) => {
              setSaveFailure(null);
              workouts.remove(id).catch(reportWorkoutFailure("Deleting a saved workout"));
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
                key={`${editingWorkout?.id ?? "new"}:${formVersion}`}
                errors={errors}
                editing={editingWorkout}
                initialName={recoveredName}
                onSave={(name) => {
                  setSaveFailure(null);
                  setRecoveredName(null);
                  // Not awaited: the server never answers offline, and the write is already queued.
                  if (editingWorkout) {
                    const edited = editingWorkout;
                    const config = currentConfig();
                    workouts.update({ ...edited, name, config }).catch((error: unknown) => {
                      reportWorkoutFailure("Updating a saved workout")(error);
                      restoreRefusedEdit(edited, name, config);
                    });
                    setEditing(null);
                    return;
                  }
                  workouts
                    .save({ name, config: currentConfig(), createdAt: timer.clock.now() })
                    .catch(reportWorkoutFailure("Saving a workout"));
                }}
              />
            }
            notice={
              <>
                <InstallBanner />
                {editingWorkout && (
                  <EditingNotice
                    workout={editingWorkout}
                    onCancel={() => {
                      setEditing(null);
                      setRecoveredName(null);
                    }}
                  />
                )}
              </>
            }
          />
        );
    }
  })();

  return (
    <div className={styles.withTabs}>
      {content}
      <TabBar
        current={tabOf(screen)}
        onSelect={(tab) => {
          // A kept name is an unsaved draft, and drafts do not outlive the Timer.
          if (tab !== "timer") setRecoveredName(null);
          setScreen(tab);
        }}
      />
    </div>
  );
}
