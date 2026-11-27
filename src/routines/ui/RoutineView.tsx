import { useId, useState } from "react";
import { isolate } from "../../i18n/messages/isolate";
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
import { ReceivedFrom } from "./ReceivedFrom";
import styles from "./RoutineView.module.css";

interface RoutineViewProps {
  routine: Routine;
  errors: readonly string[];
  onBack: () => void;
  onEdit: (routine: Routine) => void;
  onRemove: (routine: Routine) => void;
  /** Opens sending a copy to contacts; without it, no Share button is offered. */
  onShare?: (routine: Routine) => void;
}

/** Shown in a cell the exercise leaves empty. */
const EMPTY = "—";

/**
 * A routine to read: its notes, then a table per stage. Nothing here can be changed. Every text the
 * routine holds may have been written by a contact who sent it, so each is isolated: `<bdi>` where
 * it is shown, U+2068/U+2069 in accessible names and the dialog title.
 */
export function RoutineView({
  routine,
  errors,
  onBack,
  onEdit,
  onRemove,
  onShare,
}: RoutineViewProps) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <bdi>{routine.name}</bdi>
        </h1>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.back}
        </button>
      </header>

      {errors.map((error) => (
        <p key={error} className={styles.error} role="alert">
          {error}
        </p>
      ))}

      {routine.receivedFrom && (
        <p className={styles.sender}>
          <ReceivedFrom sender={routine.receivedFrom} />
        </p>
      )}

      {routine.notes !== undefined && (
        <p className={styles.notes}>
          <bdi>{routine.notes}</bdi>
        </p>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.action}
          aria-label={t.editRoutine(isolate(routine.name))}
          onClick={() => {
            onEdit(routine);
          }}
        >
          {t.edit}
        </button>
        <button
          type="button"
          className={styles.action}
          aria-label={t.deleteRoutine(isolate(routine.name))}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t.confirmDelete}
        </button>
        {onShare && (
          <button
            type="button"
            className={styles.action}
            aria-label={t.shareRoutine(isolate(routine.name))}
            onClick={() => {
              onShare(routine);
            }}
          >
            {t.share}
          </button>
        )}
      </div>

      {routine.stages.length === 0 && <p className={styles.empty}>{t.noStagesYet}</p>}
      {routine.stages.map((stage, index) => (
        <StageTable key={index} stage={stage} position={index + 1} />
      ))}

      {confirming && (
        <ConfirmDialog
          title={t.confirmDeleteRoutine(isolate(routine.name))}
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

/** A link safe to open and the site it goes to. */
interface SafeLink {
  href: string;
  host: string;
}

/**
 * Checked again here: only a safe https link to a named site ever becomes something to open, never
 * one to the local network a routine stored before it was refused may still hold.
 */
function safeLink({ link }: Exercise): SafeLink | undefined {
  const href = link === undefined ? undefined : normalizeLink(link);
  return typeof href === "string" ? { href, host: linkHost(href) } : undefined;
}

function StageTable({ stage, position }: StageTableProps) {
  const { t, language } = useI18n();
  const headingId = useId();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1, useGrouping: false });

  const columns: {
    id: Column;
    label: string;
    /** Shown instead of the label on a phone too narrow for it. */
    short?: string;
    value: (exercise: Exercise) => string;
  }[] = [
    { id: "reps", label: t.reps, short: t.repsShort, value: (exercise) => formatReps(exercise) },
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
  const links = stage.exercises.map(safeLink);
  const showLinks = links.some((link) => link !== undefined);

  return (
    <section className={styles.stage}>
      <h2 id={headingId} className={styles.stageTitle}>
        {stage.name === undefined ? t.stageNumber(position) : <bdi>{stage.name}</bdi>}
      </h2>
      {stage.notes !== undefined && (
        <p className={styles.stageNotes}>
          <bdi>{stage.notes}</bdi>
        </p>
      )}
      {stage.exercises.length > 0 && (
        // On the narrowest phones the table scrolls on its own, never the page.
        <div className={styles.tableScroll}>
          <table className={styles.table} aria-labelledby={headingId}>
            <thead>
              <tr>
                <th scope="col">{t.exerciseColumn}</th>
                {shown.map((column) => (
                  <th key={column.id} scope="col" className={styles.narrow}>
                    {column.short === undefined || column.short === column.label ? (
                      column.label
                    ) : (
                      <>
                        <span className={styles.fullLabel}>{column.label}</span>
                        <span className={styles.shortLabel} aria-hidden="true">
                          {column.short}
                        </span>
                      </>
                    )}
                  </th>
                ))}
                {showLinks && (
                  <th scope="col" className={styles.narrow}>
                    <span className={styles.visuallyHidden}>{t.exerciseLink}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {stage.exercises.map((exercise, index) => (
                <ExerciseRows
                  key={index}
                  exercise={exercise}
                  columns={shown}
                  link={showLinks ? (links[index] ?? null) : undefined}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface ExerciseRowsProps {
  exercise: Exercise;
  columns: readonly { id: Column; value: (exercise: Exercise) => string }[];
  /** The exercise's link; `null` leaves its cell empty, `undefined` means the stage has no link column. */
  link: SafeLink | null | undefined;
}

/**
 * An exercise's row, ending with a button for its link when the stage has a link column,
 * and its notes on a full-width row right below when it has any.
 */
function ExerciseRows({ exercise, columns, link }: ExerciseRowsProps) {
  const { t } = useI18n();
  const cells = columns.length + 1 + (link === undefined ? 0 : 1);
  return (
    <>
      <tr className={exercise.notes === undefined ? undefined : styles.withNotes}>
        <td className={styles.name}>
          {exercise.name === undefined ? EMPTY : <bdi>{exercise.name}</bdi>}
        </td>
        {columns.map((column) => (
          <td key={column.id} className={styles.narrow}>
            {column.value(exercise) || EMPTY}
          </td>
        ))}
        {link !== undefined && (
          <td className={`${styles.narrow} ${styles.linkCell}`}>
            {link !== null && (
              <a
                className={styles.link}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                title={link.host}
                aria-label={
                  exercise.name === undefined
                    ? t.viewLinkTo(link.host)
                    : t.viewExerciseLink(link.host, isolate(exercise.name))
                }
              >
                {t.viewLink}
              </a>
            )}
          </td>
        )}
      </tr>
      {exercise.notes !== undefined && (
        <tr>
          <td className={styles.exerciseNotes} colSpan={cells}>
            <bdi>{exercise.notes}</bdi>
          </td>
        </tr>
      )}
    </>
  );
}
