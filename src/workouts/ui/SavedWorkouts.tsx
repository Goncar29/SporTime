import { useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import {
  MAX_WORKOUT_NAME_LENGTH,
  normalizeWorkoutName,
  type SavedWorkout,
} from "../domain/savedWorkout";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import styles from "./SavedWorkouts.module.css";

interface EditingNoticeProps {
  workout: SavedWorkout;
  onCancel: () => void;
}

/** Says which saved workout the settings on screen will be saved over, at the top where it is seen. */
export function EditingNotice({ workout, onCancel }: EditingNoticeProps) {
  const { t } = useI18n();
  return (
    <div className={styles.editing}>
      <p className={styles.editingLabel}>{t.editingWorkout(workout.name)}</p>
      <button type="button" className={styles.cancelEdit} onClick={onCancel}>
        {t.cancel}
      </button>
    </div>
  );
}

interface SaveWorkoutFormProps {
  errors: readonly string[];
  /** The saved workout whose changes this form saves, or null to save a new one. */
  editing?: SavedWorkout | null;
  /** A name to start with instead of the edited workout's, such as one a refused save kept. */
  initialName?: string | null;
  onSave: (name: string) => void;
}

/** Saves the settings on screen under a name; it sits next to the settings it saves. */
export function SaveWorkoutForm({
  errors,
  editing = null,
  initialName = null,
  onSave,
}: SaveWorkoutFormProps) {
  const { t } = useI18n();
  // Callers key this form by the workout being edited, so the name starts over with it.
  const [draftName, setDraftName] = useState(initialName ?? editing?.name ?? "");
  const name = normalizeWorkoutName(draftName);

  return (
    <section className={styles.section} aria-label={t.saveWorkout}>
      {errors.map((error) => (
        <p key={error} className={styles.error} role="alert">
          {error}
        </p>
      ))}
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (name === null) return;
          onSave(name);
          setDraftName("");
        }}
      >
        <input
          className={styles.input}
          aria-label={t.workoutName}
          placeholder={t.workoutName}
          maxLength={MAX_WORKOUT_NAME_LENGTH}
          value={draftName}
          onChange={(event) => {
            setDraftName(event.target.value);
          }}
        />
        <button className={styles.save} disabled={name === null}>
          {editing ? t.saveChanges : t.saveWorkout}
        </button>
      </form>
    </section>
  );
}

interface SavedWorkoutsProps {
  /** Null until the first answer arrives. */
  workouts: readonly SavedWorkout[] | null;
  errors: readonly string[];
  onLoad: (workout: SavedWorkout) => void;
  onEdit: (workout: SavedWorkout) => void;
  onRemove: (workout: SavedWorkout) => void;
}

/** The Saved tab: every saved workout, to load into the timer, edit or delete. */
export function SavedWorkouts({ workouts, errors, onLoad, onEdit, onRemove }: SavedWorkoutsProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState<SavedWorkout | null>(null);

  return (
    <main className={styles.page}>
      <header>
        <h1 className={styles.pageTitle}>{t.savedWorkouts}</h1>
      </header>

      {errors.map((error) => (
        <p key={error} className={styles.error} role="alert">
          {error}
        </p>
      ))}

      {workouts === null && <p className={styles.empty}>{t.loading}</p>}
      {workouts?.length === 0 && <p className={styles.empty}>{t.noSavedWorkouts}</p>}
      {workouts && workouts.length > 0 && (
        <ul className={styles.list}>
          {workouts.map((workout) => (
            <li key={workout.id} className={styles.item}>
              <button
                className={styles.load}
                onClick={() => {
                  onLoad(workout);
                }}
              >
                <span className={styles.name}>{workout.name}</span>
                <span className={styles.mode}>{t.modes[workout.config.mode].label}</span>
              </button>
              <button
                className={styles.edit}
                aria-label={t.editWorkout(workout.name)}
                onClick={() => {
                  onEdit(workout);
                }}
              >
                <svg
                  className={styles.editIcon}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
                </svg>
              </button>
              <button
                className={styles.remove}
                aria-label={t.deleteWorkout(workout.name)}
                onClick={() => {
                  setPending(workout);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <ConfirmDialog
          title={t.confirmDeleteWorkout(pending.name)}
          onConfirm={() => {
            setPending(null);
            onRemove(pending);
          }}
          onCancel={() => {
            setPending(null);
          }}
        />
      )}
    </main>
  );
}
