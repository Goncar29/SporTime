import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OtherTabsStatus } from "../account/application/ports";
import { ProfileScreen } from "../account/ui/ProfileScreen";
import { useAccountDeletion } from "../account/ui/useAccountDeletion";
import { PrivacyScreen } from "../account/ui/PrivacyScreen";
import { SettingsScreen } from "../settings/ui/SettingsScreen";
import type { HistoryLog } from "../history/application/ports";
import { recordFinishedSessions } from "../history/application/recordFinishedSessions";
import { HistoryScreen } from "../history/ui/HistoryScreen";
import type { ContactStore } from "../contacts/application/ports";
import type { Contact } from "../contacts/domain/contact";
import { ContactsScreen } from "../contacts/ui/ContactsScreen";
import { useContactSaveFailures } from "../contacts/ui/useContactSaveFailures";
import type { DirectoryListing } from "../directory/application/ports";
import { FindByEmailSwitch } from "../directory/ui/FindByEmailSwitch";
import { useI18n } from "../i18n/ui/I18nProvider";
import type { RoutineLibrary } from "../routines/application/ports";
import type { Routine } from "../routines/domain/routine";
import { RoutineEditor } from "../routines/ui/RoutineEditor";
import { RoutineView } from "../routines/ui/RoutineView";
import { RoutinesScreen } from "../routines/ui/RoutinesScreen";
import type { InboxReceiving, RoutineSharing } from "../sharing/application/ports";
import { ShareRoutineScreen } from "../sharing/ui/ShareRoutineScreen";
import type { SubscribeToList } from "../shared/application/liveList";
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
  /** Without it, Profile offers no Routines section. */
  routines?: RoutineLibrary;
  /** Without it, Profile offers no switch to be found by email. */
  directory?: DirectoryListing;
  /** Without it, Profile offers no Contacts section. */
  contactStore?: ContactStore;
  /** Sends copies of routines to contacts; without it (or contacts), no routine offers Share. */
  sharing?: RoutineSharing;
  /**
   * Moves routines contacts sent into the user's routines while the app can be used; without it,
   * nothing is received.
   */
  receiving?: InboxReceiving;
  deleteAccount: () => Promise<void>;
  deletionConfirmedByRedirect: () => Promise<boolean>;
  account?: ReactNode;
  /**
   * Pending changes are being sent before signing out. A change made now could miss the send
   * and be erased with the session, so nothing can be used until it ends.
   */
  signingOut?: boolean;
  /**
   * Another tab of the account is signing out or deleting it, so nothing here can be used until
   * it ends; or it did so while a change made here waited, so that change was not saved.
   */
  otherTabs?: OtherTabsStatus;
}

/**
 * Settings, Privacy, Contacts and Routines, with its view and editor, open from Profile, so its
 * tab stays marked while they are shown.
 */
type Screen =
  | Tab
  | "settings"
  | "privacy"
  | "contacts"
  | "routines"
  | "routineView"
  | "routineEditor"
  | "routineShare";

const tabOf = (screen: Screen): Tab =>
  screen === "settings" ||
  screen === "privacy" ||
  screen === "contacts" ||
  screen === "routines" ||
  screen === "routineView" ||
  screen === "routineEditor" ||
  screen === "routineShare"
    ? "profile"
    : screen;

/** Stands in for a missing routine library: it never answers, and nothing reads it. */
const noRoutines: SubscribeToList<Routine> = () => () => undefined;
/** Stands in for a missing contact list the same way. */
const noContacts: SubscribeToList<Contact> = () => () => undefined;

export function App({
  timer,
  workouts,
  history,
  routines,
  directory,
  contactStore,
  sharing,
  receiving,
  deleteAccount,
  deletionConfirmedByRedirect,
  account,
  signingOut = false,
  otherTabs = "idle",
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
  const routineList = useLiveList(routines?.subscribe ?? noRoutines, "Loading routines");
  // Read here, so Profile can count them; unknown while loading or after a failed read.
  const liveContacts = useLiveList(contactStore?.subscribe ?? noContacts, "Loading contacts");
  const contactCount =
    liveContacts.failed || liveContacts.items === null ? null : liveContacts.items.length;
  const contactSaveFailures = useContactSaveFailures();
  // Refusals shown on Contacts are let go once it is left; one arriving later waits for it.
  const shownScreen = useRef<Screen>(screen);
  const { clear: clearContactSaveFailures } = contactSaveFailures;
  useEffect(() => {
    if (shownScreen.current === "contacts" && screen !== "contacts") clearContactSaveFailures();
    shownScreen.current = screen;
  }, [screen, clearContactSaveFailures]);
  /** The routine open in the editor, or null for a new one. */
  const [editedRoutine, setEditedRoutine] = useState<Routine | null>(null);
  /**
   * The routine being sent to contacts, as it was when Share was pressed: its copy is built from
   * this, and the screen stays to show the results even if the routine changes meanwhile.
   */
  const [sharedRoutine, setSharedRoutine] = useState<Routine | null>(null);
  /** The routine open to read, which the editor goes back to; null when opened from the list. */
  const [viewedRoutineId, setViewedRoutineId] = useState<string | null>(null);
  // Read from the live list, so an edit shows when coming back from the editor.
  const viewedRoutine =
    viewedRoutineId === null
      ? null
      : (routineList.items?.find(({ id }) => id === viewedRoutineId) ?? null);
  // Deleted meanwhile, here or on another device: there is nothing left to show.
  const viewedRoutineGone =
    screen === "routineView" && routineList.items !== null && viewedRoutine === null;
  useEffect(() => {
    if (!viewedRoutineGone) return;
    setViewedRoutineId(null);
    setScreen("routines");
  }, [viewedRoutineGone]);
  const [routineFailure, setRoutineFailure] = useState<{
    what: "save" | "delete";
    kind: StoreFailureKind;
  } | null>(null);
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
  const deletion = useAccountDeletion({
    onDelete: deleteAccount,
    confirmedByRedirect: deletionConfirmedByRedirect,
    // A deletion resumed after a redirect reports its progress and failures on Profile.
    onResume: () => {
      setScreen("profile");
    },
  });

  // A change stored after the account's data is erased and before the account is removed would
  // stay on the server for ever, so nothing can be used until the deletion ends.
  const blocked = signingOut || deletion.deleting || otherTabs !== "idle";
  // A new version of the app reloads the page, which would stop a running workout, or cut a
  // sign-out or a deletion short between its steps.
  useHoldUpdates(active !== null || blocked);
  // Received routines are saved by themselves (S7), but not while the account's session is ending:
  // a routine written then could be erased with it or outlive a deleted account. A copy not yet
  // received stays in the inbox until the next start.
  useEffect(() => (receiving && !blocked ? receiving.start() : undefined), [receiving, blocked]);

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

  /** Opens the Timer on a saved workout's settings, to run them or to edit that workout. */
  const showOnTimer = (workout: SavedWorkout, { asEdit }: { asEdit: boolean }) => {
    const { config } = workout;
    setConfigs((current) => ({ ...current, [config.mode]: config }));
    setSelectedMode(config.mode);
    setEditing(asEdit ? workout : null);
    setRecoveredName(null);
    setScreen("timer");
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

  // Outside the blocked part, so it stays visible and announced.
  const overlay = blocked && (
    <div className={styles.signingOut}>
      {signingOut ||
      deletion.deleting ||
      otherTabs === "signingOut" ||
      otherTabs === "deletingAccount" ? (
        <p className={styles.signingOutStatus} role="status">
          {signingOut
            ? t.signingOut
            : deletion.deleting
              ? t.deletingAccount
              : otherTabs === "deletingAccount"
                ? t.deletingAccountElsewhere
                : t.signingOutElsewhere}
        </p>
      ) : (
        <p className={styles.signingOutStatus} role="alert">
          {otherTabs === "lostChangeAccountDeleted"
            ? t.lostChangeAccountDeletedElsewhere
            : t.lostChangeSignedOutElsewhere}
        </p>
      )}
    </div>
  );

  if (active) {
    return (
      <>
        <div className={styles.timer} inert={blocked}>
          <TimerScreen
            mode={active.mode}
            timeline={active.timeline}
            controller={active.controller}
            onExit={handleExit}
          />
        </div>
        {overlay}
      </>
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

  const routineErrors = [
    ...(routineFailure
      ? [
          // The shared message names a workout, so a routine says it in its own words.
          routineFailure.kind === "notFound"
            ? t.routineNotFound
            : storeFailureMessage(
                t,
                routineFailure.kind,
                routineFailure.what === "save" ? t.saveFailed : t.deleteRoutineFailed,
              ),
        ]
      : []),
    ...(routineList.failed
      ? [storeFailureMessage(t, routineList.failure ?? "unknown", t.loadRoutinesFailed)]
      : []),
  ];

  /** Returns the handler for one operation, so the developer's log names what failed. */
  const reportRoutineFailure = (what: "save" | "delete", operation: string) => (error: unknown) => {
    setRoutineFailure({ what, kind: reportStoreFailure(operation, error) });
  };

  const openRoutineEditor = (routine: Routine | null) => {
    setEditedRoutine(routine);
    setScreen("routineEditor");
  };

  const openRoutineList = () => {
    setViewedRoutineId(null);
    setScreen("routines");
  };

  /** Where the editor goes back to: the routine it was opened from, or the list. */
  const closeRoutineEditor = () => {
    setEditedRoutine(null);
    setScreen(viewedRoutineId === null ? "routines" : "routineView");
  };

  const removeRoutine = ({ id }: Routine) => {
    setRoutineFailure(null);
    // Not awaited: the server never answers offline, and the write is already queued.
    routines?.remove(id).catch(reportRoutineFailure("delete", "Deleting a routine"));
  };

  const content = (() => {
    switch (screen) {
      case "saved":
        return (
          <SavedWorkouts
            workouts={library.failed ? (library.items ?? []) : library.items}
            errors={errors}
            onLoad={(workout) => {
              showOnTimer(workout, { asEdit: false });
            }}
            onEdit={(workout) => {
              showOnTimer(workout, { asEdit: true });
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
            onOpenRoutines={
              routines &&
              (() => {
                setScreen("routines");
              })
            }
            onOpenContacts={
              contactStore &&
              (() => {
                // The listener stops for good after an error, so opening Contacts reads again.
                if (liveContacts.failed) liveContacts.retry();
                setScreen("contacts");
              })
            }
            contactCount={contactCount}
            findByEmail={directory && <FindByEmailSwitch listing={directory} />}
          />
        );
      case "contacts":
        return (
          contactStore && (
            <ContactsScreen
              contactStore={contactStore}
              liveContacts={liveContacts}
              saveFailures={contactSaveFailures}
              findByEmail={
                directory && (
                  <FindByEmailSwitch listing={directory} note={t.findByEmailContactsHint} />
                )
              }
              onBack={openProfile}
            />
          )
        );
      case "routines":
        return (
          routines && (
            <RoutinesScreen
              routines={routineList.failed ? (routineList.items ?? []) : routineList.items}
              errors={routineErrors}
              onBack={openProfile}
              onNew={() => {
                setViewedRoutineId(null);
                openRoutineEditor(null);
              }}
              onOpen={({ id }) => {
                setViewedRoutineId(id);
                setScreen("routineView");
              }}
              onEdit={(routine) => {
                setViewedRoutineId(null);
                openRoutineEditor(routine);
              }}
              onRemove={removeRoutine}
            />
          )
        );
      case "routineView":
        return (
          routines &&
          viewedRoutine && (
            <RoutineView
              key={viewedRoutine.id}
              routine={viewedRoutine}
              errors={routineErrors}
              onBack={openRoutineList}
              onEdit={openRoutineEditor}
              onRemove={(routine) => {
                removeRoutine(routine);
                openRoutineList();
              }}
              onShare={
                sharing &&
                contactStore &&
                ((routine) => {
                  // The listener stops for good after an error, so picking contacts reads again.
                  if (liveContacts.failed) liveContacts.retry();
                  setSharedRoutine(routine);
                  setScreen("routineShare");
                })
              }
            />
          )
        );
      case "routineShare":
        return (
          sharing &&
          sharedRoutine && (
            <ShareRoutineScreen
              key={sharedRoutine.id}
              routine={sharedRoutine}
              liveContacts={liveContacts}
              sharing={sharing}
              onBack={() => {
                setSharedRoutine(null);
                setScreen("routineView");
              }}
              onOpenContacts={() => {
                setSharedRoutine(null);
                setScreen("contacts");
              }}
            />
          )
        );
      case "routineEditor":
        return (
          routines && (
            <RoutineEditor
              key={editedRoutine?.id ?? "new"}
              routine={editedRoutine}
              onSave={(draft) => {
                setRoutineFailure(null);
                // Not awaited: the server never answers offline, and the write is already queued.
                if (editedRoutine) {
                  routines
                    .update({ ...draft, id: editedRoutine.id })
                    .catch(reportRoutineFailure("save", "Updating a routine"));
                } else {
                  routines.save(draft).catch(reportRoutineFailure("save", "Saving a routine"));
                }
                closeRoutineEditor();
              }}
              onCancel={closeRoutineEditor}
            />
          )
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
    <>
      <div className={styles.withTabs} inert={blocked}>
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
      {overlay}
    </>
  );
}
