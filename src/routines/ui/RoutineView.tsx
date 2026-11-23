import { useId, useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { ConfirmDialog } from "../../shared/ui/ConfirmDialog";
import {
  formatReps,
  formatRest,
  linkHost,
  normalizeLink,
  type Exercise,
  type Routine,
  type Stage,
} from "../domain/routine";
import styles from "./RoutineView.module.css";

interface RoutineViewProps {
  routine: Routine;
  errors: readonly string[];
  onBack: () => void;
  onEdit: (routine: Routine) => void;
  onRemove: (routine: Routine) => void;
}

/** Shown in a cell the exercise leaves empty. */
const EMPTY = "—";

/** A routine to read: its notes, then a table per stage. Nothing here can be changed. */
export function RoutineView({ routine, errors, onBack, onEdit, onRemove }: RoutineViewProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{routine.name}</h1>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>

      {errors.map((error) => (
        <p key={error} className={styles.error} role="alert">
          {error}
        </p>
      ))}

      {routine.notes !== undefined && <p className={styles.notes}>{routine.notes}</p>}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          aria-label={t.editRoutine(routine.name)}
          onClick={() => {
            onEdit(routine);
          }}
        >
          {t.edit}
        </button>
        <button
          type="button"
          className={styles.action}
          aria-label={t.deleteRoutine(routine.name)}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t.confirmDelete}
        </button>
      </div>

      {routine.stages.length === 0 && <p className={styles.empty}>{t.noStagesYet}</p>}
      {routine.stages.map((stage, index) => (
        <StageTable key={index} stage={stage} position={index + 1} />
      ))}

      {confirming && (
        <ConfirmDialog
          title={t.confirmDeleteRoutine(routine.name)}
          onConfirm={() => {
            setConfirming(false);
            onRemove(routine);
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      )}
    </main>
  );
}

type Column = "reps" | "rest" | "weight";

interface StageTableProps {
  stage: Stage;
  position: number;
}

function StageTable({ stage, position }: StageTableProps) {
  const { t, language } = useI18n();
  const headingId = useId();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1, useGrouping: false });

  const columns: { id: Column; label: string; value: (exercise: Exercise) => string }[] = [
    { id: "reps", label: t.reps, value: (exercise) => formatReps(exercise) },
    {
      id: "rest",
      label: t.restTime,
      value: ({ restSeconds }) => (restSeconds === undefined ? "" : formatRest(restSeconds)),
    },
    {
      id: "weight",
      label: t.weight,
      value: ({ weight, weightUnit }) =>
        weight === undefined ? "" : `${number.format(weight)} ${weightUnit ?? "kg"}`,
    },
  ];
  // A column no exercise of the stage fills only takes room on a narrow screen.
  const shown = columns.filter((column) =>
    stage.exercises.some((exercise) => column.value(exercise) !== ""),
  );

  return (
    <section className={styles.stage}>
      <h2 id={headingId} className={styles.stageTitle}>
        {stage.name ?? t.stageNumber(position)}
      </h2>
      {stage.notes !== undefined && <p className={styles.stageNotes}>{stage.notes}</p>}
      {stage.exercises.length > 0 && (
        <table className={styles.table} aria-labelledby={headingId}>
          <thead>
            <tr>
              <th scope="col">{t.exerciseColumn}</th>
              {shown.map((column) => (
                <th key={column.id} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stage.exercises.map((exercise, index) => (
              <ExerciseRows key={index} exercise={exercise} columns={shown} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface ExerciseRowsProps {
  exercise: Exercise;
  columns: readonly { id: Column; value: (exercise: Exercise) => string }[];
}

/**
 * An exercise's row, and its notes and link on a full-width row right below when it has any,
 * so the table keeps its few narrow columns.
 */
function ExerciseRows({ exercise, columns }: ExerciseRowsProps) {
  const { t } = useI18n();
  // Checked again here: only a safe https link ever becomes something to open.
  const link = exercise.link === undefined ? undefined : normalizeLink(exercise.link);
  const host = typeof link === "string" ? linkHost(link) : undefined;
  const hasDetails = exercise.notes !== undefined || host !== undefined;
  return (
    <>
      <tr className={hasDetails ? styles.withNotes : undefined}>
        <td className={styles.name}>{exercise.name ?? EMPTY}</td>
        {columns.map((column) => (
          <td key={column.id}>{column.value(exercise) || EMPTY}</td>
        ))}
      </tr>
      {hasDetails && (
        <tr>
          <td className={styles.exerciseNotes} colSpan={columns.length + 1}>
            {exercise.notes}
            {typeof link === "string" && host !== undefined && (
              <a
                className={styles.link}
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={
                  exercise.name === undefined
                    ? t.openLink(host)
                    : t.openExerciseLink(host, exercise.name)
                }
              >
                {t.openLink(host)} <span aria-hidden="true">↗</span>
              </a>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
