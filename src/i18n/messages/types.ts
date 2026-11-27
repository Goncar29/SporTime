import type { ContactRefusal } from "../../contacts/domain/contact";
import type { DeliveryOutcome } from "../../sharing/application/ports";
import type { ShareProblem } from "../../sharing/domain/sharedCopy";
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
  /** Shows the next page of a long list: saved workouts, routines (T38). */
  showMore: string;
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
  /**
   * Marks a routine received from a contact (S12). `name` and `email` arrive isolated; `name` is
   * null when the sender has none, and then only the email is said.
   */
  receivedFrom(name: string | null, email: string): string;
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
  /** A link to localhost, an IP address or a local network name, refused like any unsafe one. */
  localLink: string;
  /** The visible text of the button that opens an exercise's link. */
  viewLink: string;
  /** Its accessible name, by the link's site, when the exercise has no name. */
  viewLinkTo(host: string): string;
  /** Its accessible name when the exercise has a name. */
  viewExerciseLink(host: string, exercise: string): string;
  /** The Profile switch that lists the user in the directory, found by exact email. */
  findByEmail: string;
  /** What turning it on shows, and to whom. */
  findByEmailHint: string;
  /** Shown above that hint on the Contacts screen: turning it on lets others add you. */
  findByEmailContactsHint: string;
  findByEmailChangeFailed: string;
  findByEmailLoadFailed: string;
  /** The Contacts section of Profile: people found by the exact email they let others use. */
  contacts: string;
  /** The Profile menu item with how many contacts there are, such as "Contacts · 3". */
  contactsMenuItem(total: number): string;
  /** Its accessible name, starting with `contacts`, with the count in words. */
  contactsMenuLabel(total: number): string;
  /** What there is to do with no contacts yet, naming the switch they must turn on. */
  noContacts: string;
  /** How many contacts are kept, out of the most allowed. */
  contactCount(total: number, max: number): string;
  /** The email field's label. */
  contactEmail: string;
  addContact: string;
  addingContact: string;
  contactAdded: string;
  /** Why someone cannot be added, by refusal; `notListed` names the switch `findByEmail`. */
  contactRefusals: Record<ContactRefusal, string>;
  /** Adding failed for a reason none of the refusals explains. */
  addContactFailed: string;
  loadContactsFailed: string;
  removeContactFailed: string;
  /**
   * The server refused a contact added on this device; `name` arrives isolated, and
   * `stillListed` says whether this device still shows them.
   */
  contactNotSaved(name: string, stillListed: boolean): string;
  /** `name` arrives isolated, so its direction cannot reorder the words around it. */
  removeContact(name: string): string;
  confirmRemoveContact(name: string): string;
  removeContactNote: string;
  confirmRemoveContactAction: string;
  /** Sending a copy of a routine to contacts (S12): the button in the routine's view. */
  share: string;
  /** Its accessible name. */
  shareRoutine(name: string): string;
  /** The screen where the recipients are picked. */
  shareTitle: string;
  shareChooseContacts: string;
  /** With no contacts yet, pointing to Contacts. */
  shareNoContacts: string;
  shareOpenContacts: string;
  shareContinue: string;
  /** `routine` and every name arrive isolated; the names are joined as a list. */
  confirmShare(routine: string, names: readonly string[]): string;
  /** What the recipients get, and what they see of the sender. */
  shareNote: string;
  shareSend: string;
  shareSending: string;
  shareNeedsConnection: string;
  /** The copy could not be prepared, for a reason none of the others explains. */
  shareFailed: string;
  /** Before the list of what keeps the routine from being shared. */
  shareCannotSend: string;
  /** What to fix before sending; an exercise's name arrives isolated. */
  shareProblem(problem: ShareProblem): string;
  shareResults: string;
  /** What became of one recipient's copy; `failed` is followed by its reason when known. */
  shareOutcomes: Record<DeliveryOutcome, string>;
  shareDone: string;
  /** The mark on a received routine not seen before in the list (T27, S7). */
  newRoutineMark: string;
  /** The accessible name of a new routine in the list; `name` arrives isolated. */
  openNewRoutine(name: string): string;
  /** The Profile menu item with how many received routines are new, such as "Routines · 2 new". */
  routinesMenuItem(newCount: number): string;
  /** Its accessible name, starting with `routines`, with the count in words. */
  routinesMenuLabel(newCount: number): string;
  /**
   * Blocking the sender of a received routine (T27, S7). `name` and `email` arrive isolated;
   * `name` is null when the sender has none, and then only the email is said.
   */
  blockSender(name: string | null, email: string): string;
  confirmBlockSender(name: string | null, email: string): string;
  /** What blocking does: no more routines from them, and the received ones stay. */
  blockSenderNote: string;
  blockAction: string;
  /** Said on a received routine whose sender is blocked; arguments as for `blockSender`. */
  senderBlocked(name: string | null, email: string): string;
  blockFailed: string;
  /** The blocked list, reached from Contacts. */
  blocked: string;
  noBlocked: string;
  unblock: string;
  /** The accessible name of Unblock for one person; `name` arrives isolated. */
  unblockSender(name: string): string;
  unblockFailed: string;
  loadBlockedFailed: string;
  /** The list of copies a contact sent that could not be opened (T29 W5), in Routines. */
  unopenedRoutines: string;
  /**
   * One such copy, by its sender; arguments as for `blockSender` (isolated, `name` null when the
   * sender has none).
   */
  unopenedRoutine(name: string | null, email: string): string;
  /** The accessible name of its Delete button; arguments as for `unopenedRoutine`. */
  deleteUnopenedRoutine(name: string | null, email: string): string;
  /** The visible text of the button that blocks its sender. */
  blockSenderAction: string;
}
