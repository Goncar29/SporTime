import { useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import {
  ROUTINE_LIMITS,
  WEIGHT_UNITS,
  formatReps,
  formatRest,
  isLocalLink,
  normalizeLink,
  normalizeRoutineName,
  parseRepsInput,
  parseRestInput,
  parseRoutine,
  parseWeightInput,
  type Exercise,
  type Routine,
  type RoutineDraft,
  type WeightUnit,
} from "../domain/routine";
import styles from "./RoutineEditor.module.css";

/** What the user typed for one exercise; every field may stay empty. */
interface ExerciseForm {
  key: number;
  name: string;
  reps: string;
  rest: string;
  weight: string;
  unit: WeightUnit;
  notes: string;
  link: string;
}

interface StageForm {
  key: number;
  name: string;
  notes: string;
  exercises: ExerciseForm[];
}

interface RoutineEditorProps {
  /** The routine to edit, or null to create one. */
  routine: Routine | null;
  /** Called with the routine as stored: empty exercises and stages left out. */
  onSave: (draft: RoutineDraft) => void;
  onCancel: () => void;
}

const exerciseForm = (key: number, exercise?: Exercise): ExerciseForm => ({
  key,
  name: exercise?.name ?? "",
  reps: exercise ? formatReps(exercise) : "",
  rest: exercise?.restSeconds === undefined ? "" : formatRest(exercise.restSeconds),
  weight: exercise?.weight === undefined ? "" : String(exercise.weight),
  unit: exercise?.weightUnit ?? "kg",
  notes: exercise?.notes ?? "",
  link: exercise?.link ?? "",
});

const fieldErrors = (exercise: ExerciseForm) => ({
  reps: parseRepsInput(exercise.reps) === null,
  rest: parseRestInput(exercise.rest) === null,
  weight: parseWeightInput(exercise.weight) === null,
  link: normalizeLink(exercise.link) === null,
});

/** The typed exercise in the routine's shape; only called once every field reads. */
function toExercise(form: ExerciseForm): Exercise {
  const weight = parseWeightInput(form.weight) ?? undefined;
  return {
    name: form.name,
    ...parseRepsInput(form.reps),
    restSeconds: parseRestInput(form.rest) ?? undefined,
    weight,
    weightUnit: weight === undefined ? undefined : form.unit,
    notes: form.notes,
    link: normalizeLink(form.link) ?? undefined,
  };
}

/** Creates or edits a routine: its name, notes and stages, each with optional exercises. */
export function RoutineEditor({ routine, onSave, onCancel }: RoutineEditorProps) {
  const { t } = useI18n();
  const nextKey = useRef(0);
  const newKey = () => nextKey.current++;
  const [name, setName] = useState(routine?.name ?? "");
  const [notes, setNotes] = useState(routine?.notes ?? "");
  const [stages, setStages] = useState<StageForm[]>(() =>
    (routine?.stages ?? []).map((stage) => ({
      key: newKey(),
      name: stage.name ?? "",
      notes: stage.notes ?? "",
      exercises: stage.exercises.map((exercise) => exerciseForm(newKey(), exercise)),
    })),
  );

  const validName = normalizeRoutineName(name);
  const anyInvalid = stages.some((stage) =>
    stage.exercises.some((exercise) => Object.values(fieldErrors(exercise)).some(Boolean)),
  );
  const canSave = validName !== null && !anyInvalid;

  const changeStage = (key: number, change: (stage: StageForm) => StageForm) => {
    setStages((current) => current.map((stage) => (stage.key === key ? change(stage) : stage)));
  };
  const changeExercise = (stageKey: number, exerciseKey: number, change: Partial<ExerciseForm>) => {
    changeStage(stageKey, (stage) => ({
      ...stage,
      exercises: stage.exercises.map((exercise) =>
        exercise.key === exerciseKey ? { ...exercise, ...change } : exercise,
      ),
    }));
  };

  const save = () => {
    if (!canSave) return;
    // The domain drops blank text and empty exercises and stages, as storage does.
    const parsed = parseRoutine(routine?.id ?? "", {
      name,
      notes,
      createdAt: routine?.createdAt ?? Date.now(),
      stages: stages.map((stage) => ({
        name: stage.name,
        notes: stage.notes,
        exercises: stage.exercises.map(toExercise),
      })),
    });
    if (!parsed) return;
    const { id: _id, ...draft } = parsed;
    onSave(draft);
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{routine ? t.editRoutineTitle : t.newRoutine}</h1>
      </header>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className={styles.field}>
          <span className={styles.label}>{t.routineName}</span>
          <input
            className={styles.input}
            required
            maxLength={ROUTINE_LIMITS.nameLength}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t.routineNotes}</span>
          <textarea
            className={styles.textarea}
            rows={3}
            maxLength={ROUTINE_LIMITS.notesLength}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
        </label>

        {stages.map((stage, stageIndex) => {
          const stageLabel = stage.name.trim() || t.stageNumber(stageIndex + 1);
          return (
            <fieldset key={stage.key} className={styles.stage}>
              <legend className={styles.stageTitle}>{stageLabel}</legend>
              <div className={styles.stageHeader}>
                <label className={styles.field}>
                  <span className={styles.label}>{t.stageName}</span>
                  <input
                    className={styles.input}
                    maxLength={ROUTINE_LIMITS.stageNameLength}
                    placeholder={t.stageNumber(stageIndex + 1)}
                    value={stage.name}
                    onChange={(event) => {
                      const value = event.target.value;
                      changeStage(stage.key, (current) => ({ ...current, name: value }));
                    }}
                  />
                </label>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={t.removeStage(stageLabel)}
                  onClick={() => {
                    setStages((current) => current.filter(({ key }) => key !== stage.key));
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
              <label className={styles.field}>
                <span className={styles.label}>{t.stageNotes}</span>
                <textarea
                  className={styles.textarea}
                  rows={2}
                  maxLength={ROUTINE_LIMITS.notesLength}
                  value={stage.notes}
                  onChange={(event) => {
                    const value = event.target.value;
                    changeStage(stage.key, (current) => ({ ...current, notes: value }));
                  }}
                />
              </label>

              {stage.exercises.map((exercise, exerciseIndex) => (
                <ExerciseRow
                  key={exercise.key}
                  position={exerciseIndex + 1}
                  exercise={exercise}
                  onChange={(change) => {
                    changeExercise(stage.key, exercise.key, change);
                  }}
                  onRemove={() => {
                    changeStage(stage.key, (current) => ({
                      ...current,
                      exercises: current.exercises.filter(({ key }) => key !== exercise.key),
                    }));
                  }}
                />
              ))}

              <button
                type="button"
                className={styles.add}
                disabled={stage.exercises.length >= ROUTINE_LIMITS.exercisesPerStage}
                onClick={() => {
                  const key = newKey();
                  changeStage(stage.key, (current) => ({
                    ...current,
                    exercises: [...current.exercises, exerciseForm(key)],
                  }));
                }}
              >
                {t.addExercise}
              </button>
            </fieldset>
          );
        })}

        <button
          type="button"
          className={styles.add}
          disabled={stages.length >= ROUTINE_LIMITS.stages}
          onClick={() => {
            const key = newKey();
            const exerciseKey = newKey();
            setStages((current) => [
              ...current,
              { key, name: "", notes: "", exercises: [exerciseForm(exerciseKey)] },
            ]);
          }}
        >
          {t.addStage}
        </button>

        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            {t.cancel}
          </button>
          <button type="submit" className={styles.save} disabled={!canSave}>
            {routine ? t.saveChanges : t.saveRoutine}
          </button>
        </div>
      </form>
    </main>
  );
}

interface ExerciseRowProps {
  position: number;
  exercise: ExerciseForm;
  onChange: (change: Partial<ExerciseForm>) => void;
  onRemove: () => void;
}

function ExerciseRow({ position, exercise, onChange, onRemove }: ExerciseRowProps) {
  const { t } = useI18n();
  const id = useId();
  const errors = fieldErrors(exercise);

  return (
    <fieldset className={styles.exercise}>
      <legend className={styles.exerciseTitle}>{t.exerciseNumber(position)}</legend>
      <div className={styles.exerciseHeader}>
        <label className={styles.field}>
          <span className={styles.label}>{t.exerciseName}</span>
          <input
            className={styles.input}
            maxLength={ROUTINE_LIMITS.exerciseNameLength}
            value={exercise.name}
            onChange={(event) => {
              onChange({ name: event.target.value });
            }}
          />
        </label>
        <button
          type="button"
          className={styles.remove}
          aria-label={t.removeExercise(position)}
          onClick={onRemove}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className={styles.numbers}>
        <label className={styles.field}>
          <span className={styles.label}>{t.reps}</span>
          <input
            className={styles.input}
            inputMode="text"
            placeholder="8 - 10"
            maxLength={20}
            value={exercise.reps}
            aria-invalid={errors.reps}
            aria-describedby={errors.reps ? `${id}-reps` : undefined}
            onChange={(event) => {
              onChange({ reps: event.target.value });
            }}
            onBlur={() => {
              const reps = parseRepsInput(exercise.reps);
              if (reps) onChange({ reps: formatReps(reps) });
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t.restTime}</span>
          <input
            className={styles.input}
            placeholder={formatRest(90)}
            maxLength={20}
            value={exercise.rest}
            aria-invalid={errors.rest}
            aria-describedby={errors.rest ? `${id}-rest` : undefined}
            onChange={(event) => {
              onChange({ rest: event.target.value });
            }}
            onBlur={() => {
              const rest = parseRestInput(exercise.rest);
              if (typeof rest === "number") onChange({ rest: formatRest(rest) });
            }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t.weight}</span>
          <input
            className={styles.input}
            inputMode="decimal"
            placeholder="62.5"
            maxLength={20}
            value={exercise.weight}
            aria-invalid={errors.weight}
            aria-describedby={errors.weight ? `${id}-weight` : undefined}
            onChange={(event) => {
              onChange({ weight: event.target.value });
            }}
          />
        </label>
        <div className={styles.units} role="group" aria-label={t.weightUnit}>
          {WEIGHT_UNITS.map((unit) => (
            <button
              key={unit}
              type="button"
              className={styles.unit}
              aria-pressed={exercise.unit === unit}
              onClick={() => {
                onChange({ unit });
              }}
            >
              {unit}
            </button>
          ))}
        </div>
      </div>

      {errors.reps && (
        <p id={`${id}-reps`} className={styles.fieldError}>
          {t.invalidReps}
        </p>
      )}
      {errors.rest && (
        <p id={`${id}-rest`} className={styles.fieldError}>
          {t.invalidRest}
        </p>
      )}
      {errors.weight && (
        <p id={`${id}-weight`} className={styles.fieldError}>
          {t.invalidWeight}
        </p>
      )}

      <label className={styles.field}>
        <span className={styles.label}>{t.exerciseNotes}</span>
        <input
          className={styles.input}
          maxLength={ROUTINE_LIMITS.exerciseNotesLength}
          value={exercise.notes}
          onChange={(event) => {
            onChange({ notes: event.target.value });
          }}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>{t.exerciseLink}</span>
        <input
          className={styles.input}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://…"
          value={exercise.link}
          aria-invalid={errors.link}
          aria-describedby={errors.link ? `${id}-link` : undefined}
          onChange={(event) => {
            onChange({ link: event.target.value });
          }}
        />
      </label>
      {errors.link && (
        <p id={`${id}-link`} className={styles.fieldError}>
          {/* A link to the local network may come from a routine stored before it was refused. */}
          {isLocalLink(exercise.link) ? t.localLink : t.invalidLink}
        </p>
      )}
    </fieldset>
  );
}
