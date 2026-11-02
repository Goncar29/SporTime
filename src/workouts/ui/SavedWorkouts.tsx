import { useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import {
  MAX_WORKOUT_NAME_LENGTH,
  normalizeWorkoutName,
  type SavedWorkout,
} from "../domain/savedWorkout";
import styles from "./SavedWorkouts.module.css";

interface SavedWorkoutsProps {
  workouts: readonly SavedWorkout[];
  errors: readonly string[];
  onSave(name: string): void;
  onLoad(workout: SavedWorkout): void;
  onRemove(workout: SavedWorkout): void;
  onOpenHistory(): void;
}

export function SavedWorkouts({
  workouts,
  errors,
  onSave,
  onLoad,
  onRemove,
  onOpenHistory,
}: SavedWorkoutsProps) {
  const { t } = useI18n();
  const [draftName, setDraftName] = useState("");
  const name = normalizeWorkoutName(draftName);

  return (
    <section className={styles.section} aria-label={t.savedWorkouts}>
      <div className={styles.heading}>
        <h2 className={styles.title}>{t.savedWorkouts}</h2>
        <button className={styles.link} onClick={onOpenHistory}>
          {t.history}
        </button>
      </div>

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
          {t.saveWorkout}
        </button>
      </form>

      {workouts.length === 0 ? (
        <p className={styles.empty}>{t.noSavedWorkouts}</p>
      ) : (
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
                className={styles.remove}
                aria-label={t.deleteWorkout(workout.name)}
                onClick={() => {
                  if (window.confirm(t.confirmDeleteWorkout(workout.name))) onRemove(workout);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
