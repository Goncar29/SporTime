import type { SoundSettings } from "../../timer/domain/soundSettings";
import type { PhaseKind } from "../../workouts/domain/timeline";
import type { FieldId, WorkoutMode } from "../../workouts/domain/workout";

export interface MarkMessages {
  action: string;
  count(total: number): string;
}

export interface Messages {
  tagline: string;
  language: string;
  modes: Record<WorkoutMode, { label: string; description: string }>;
  fields: Record<FieldId, string>;
  phases: Record<PhaseKind, string>;
  increase(field: string): string;
  decrease(field: string): string;
  roundNames: string;
  roundNamesHint: string;
  roundNameLabel(round: number): string;
  start: string;
  noLimit: string;
  paused: string;
  round(current: number, total: number): string;
  set(current: number, total: number): string;
  next(phase: string): string;
  pause: string;
  resume: string;
  exit: string;
  skip: string;
  finish: string;
  lapMark: MarkMessages;
  roundMark: MarkMessages;
  done: string;
  workoutComplete: string;
  totalTime: string;
  setResult(set: number, time: string): string;
  goAgain: string;
  newWorkout: string;
  signInHeadline: string;
  continueWithGoogle: string;
  signingIn: string;
  signInDataNote: string;
  signInErrorNetwork: string;
  signInErrorUnknown: string;
  signOut: string;
  signingOut: string;
  signOutFailed: string;
  /** Another tab of the account is signing out, which blocks this one meanwhile. */
  signingOutElsewhere: string;
  /** A change made here waited for that sign-out, which ended the session, so it was not saved. */
  lostChangeSignedOutElsewhere: string;
  /** Another tab of the account is deleting it, which blocks this one meanwhile. */
  deletingAccountElsewhere: string;
  /** A change made here waited for that deletion, which removed the account, so it was not saved. */
  lostChangeAccountDeletedElsewhere: string;
  /** The warning before signing out with changes that could not be sent. */
  unsentChanges: string;
  unsentChangesWarning: string;
  stay: string;
  signOutAnyway: string;
  savedWorkouts: string;
  workoutName: string;
  saveWorkout: string;
  noSavedWorkouts: string;
  deleteWorkout(name: string): string;
  editWorkout(name: string): string;
  editingWorkout(name: string): string;
  saveChanges: string;
  confirmDeleteWorkout(name: string): string;
  confirmDelete: string;
  cancel: string;
  cannotBeUndone: string;
  deleteSession(when: string): string;
  confirmDeleteSession: string;
  deleteSessionFailed: string;
  saveFailed: string;
  sessionSaveFailed: string;
  loadWorkoutsFailed: string;
  /** Why the account's data store refused a save, delete or load. */
  failureNotFound: string;
  failureDenied: string;
  failureSessionEnded: string;
  failureOffline: string;
  failureBusy: string;
  history: string;
  /** The bottom tab bar and its tabs. */
  sections: string;
  tabTimer: string;
  tabSaved: string;
  profile: string;
  /** Installing the app on the device. */
  installTitle: string;
  installOffer: string;
  installIosSteps: string;
  install: string;
  notNow: string;
  installApp: string;
  historyEmpty: string;
  loadHistoryFailed: string;
  back: string;
  loading: string;
  settings: string;
  soundSettings: string;
  soundOptions: Record<keyof SoundSettings, string>;
  voiceNote: string;
  voiceUnavailable: string;
  spokenTenSecondsLeft: string;
  spokenHalfway: string;
  spokenFinish: string;
  privacy: string;
  privacySections: readonly { heading: string; body: string }[];
  privacyContactHeading: string;
  /** Shown before the contact email, which is not translated. */
  privacyContactBody: string;
  deleteAccount: string;
  deleteAccountWarning: string;
  deleteAccountConfirmNote: string;
  confirmDeleteAccount: string;
  deletingAccount: string;
  keepAccount: string;
  deleteAccountErrorNetwork: string;
  deleteAccountErrorUnknown: string;
  deleteAccountErrorWrongAccount: string;
  deleteAccountErrorUnfinished: string;
  deleteAccountErrorSessionEnded: string;
  /** The deletion never started, because a change in another tab was still being saved. */
  deleteAccountErrorChangeInAnotherTab: string;
  accountLoadFailed: string;
  tryAgain: string;
  /** The Routines section of Profile, and its editor. */
  routines: string;
  newRoutine: string;
  editRoutineTitle: string;
  noRoutines: string;
  loadRoutinesFailed: string;
  routineNotFound: string;
  deleteRoutineFailed: string;
  stageCount(total: number): string;
  editRoutine(name: string): string;
  deleteRoutine(name: string): string;
  /** The read-only view of a routine, a table per stage. */
  openRoutine(name: string): string;
  edit: string;
  noStagesYet: string;
  exerciseColumn: string;
  confirmDeleteRoutine(name: string): string;
  routineName: string;
  routineNotes: string;
  saveRoutine: string;
  /** How a stage without a name is shown, by its position. */
  stageNumber(position: number): string;
  stageName: string;
  stageNotes: string;
  addStage: string;
  removeStage(stage: string): string;
  exerciseNumber(position: number): string;
  exerciseName: string;
  reps: string;
  /** The reps column header on a phone too narrow for `reps`. */
  repsShort: string;
  restTime: string;
  weight: string;
  weightUnit: string;
  exerciseNotes: string;
  addExercise: string;
  removeExercise(position: number): string;
  invalidReps: string;
  invalidRest: string;
  invalidWeight: string;
  /** An exercise's optional https link. */
  exerciseLink: string;
  invalidLink: string;
  /** The visible text of the button that opens an exercise's link. */
  viewLink: string;
  /** Its accessible name, by the link's site, when the exercise has no name. */
  viewLinkTo(host: string): string;
  /** Its accessible name when the exercise has a name. */
  viewExerciseLink(host: string, exercise: string): string;
}
