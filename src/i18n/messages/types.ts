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
  savedWorkouts: string;
  workoutName: string;
  saveWorkout: string;
  noSavedWorkouts: string;
  deleteWorkout(name: string): string;
  confirmDeleteWorkout(name: string): string;
  saveFailed: string;
  loadWorkoutsFailed: string;
  history: string;
  historyEmpty: string;
  loadHistoryFailed: string;
  back: string;
}
