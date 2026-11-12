import { useEffect, useId, useRef, type ReactNode } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { formatClock } from "../../timer/domain/format";
import { buildTimeline } from "../domain/timeline";
import {
  MAX_ROUND_NAME_LENGTH,
  MODES,
  hasRoundNames,
  modeDefinition,
  stepField,
  type FieldDefinition,
  type WorkoutConfig,
  type WorkoutMode,
} from "../domain/workout";
import styles from "./WorkoutSetup.module.css";

interface WorkoutSetupProps {
  config: WorkoutConfig;
  onSelectMode: (mode: WorkoutMode) => void;
  onChange: (config: WorkoutConfig) => void;
  onStart: () => void;
  /** Saves the settings on screen. */
  saveForm?: ReactNode;
}

export function WorkoutSetup({
  config,
  onSelectMode,
  onChange,
  onStart,
  saveForm,
}: WorkoutSetupProps) {
  const { t } = useI18n();
  const { totalMs } = buildTimeline(config);
  const definition = modeDefinition(config.mode);
  const modesRef = useRef<HTMLDivElement>(null);

  // On a phone the chips scroll sideways, and the selected one may start out of view.
  useEffect(() => {
    const row = modesRef.current;
    const selected = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !selected) return;
    const start = selected.offsetLeft - row.offsetLeft;
    const end = start + selected.offsetWidth;
    if (start < row.scrollLeft || end > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = start - (row.clientWidth - selected.offsetWidth) / 2;
    }
  }, [config.mode]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.brand}>Sportime</h1>
        <p className={styles.tagline}>{t.tagline}</p>
      </header>

      <div className={styles.modePicker}>
        <div className={styles.modes} ref={modesRef}>
          {MODES.map((mode) => (
            <button
              key={mode.id}
              className={styles.mode}
              aria-pressed={mode.id === config.mode}
              onClick={() => {
                onSelectMode(mode.id);
              }}
            >
              {t.modes[mode.id].label}
            </button>
          ))}
        </div>
        <p className={styles.modeDescription}>{t.modes[config.mode].description}</p>
      </div>

      <div className={styles.fields}>
        {definition.fields.map((field) => (
          <Stepper
            key={field.key}
            field={field}
            value={config[field.key]}
            onChange={(value) => {
              onChange({ ...config, [field.key]: value });
            }}
          />
        ))}
      </div>

      {hasRoundNames(config.mode) && (
        <RoundNames
          rounds={config.rounds}
          names={config.roundNames ?? []}
          onChange={(roundNames) => {
            onChange({ ...config, roundNames });
          }}
        />
      )}

      {saveForm}

      <div className={styles.startBar}>
        <button className={styles.start} onClick={onStart}>
          <span>{t.start}</span>
          <span className={styles.startTotal}>
            {totalMs === null ? t.noLimit : formatClock(totalMs)}
          </span>
        </button>
      </div>
    </main>
  );
}

interface RoundNamesProps {
  rounds: number;
  /** As typed; the domain trims them when the workout starts or is saved. */
  names: readonly string[];
  onChange: (names: string[]) => void;
}

function RoundNames({ rounds, names, onChange }: RoundNamesProps) {
  const { t } = useI18n();
  const hintId = useId();

  return (
    <details className={styles.roundNames}>
      <summary className={styles.roundNamesSummary}>{t.roundNames}</summary>
      <p id={hintId} className={styles.roundNamesHint}>
        {t.roundNamesHint}
      </p>
      <div className={styles.roundNameFields}>
        {Array.from({ length: rounds }, (_, index) => (
          <label key={index} className={styles.roundName}>
            <span className={styles.roundNameLabel}>{t.roundNameLabel(index + 1)}</span>
            <input
              className={styles.roundNameInput}
              type="text"
              value={names[index] ?? ""}
              placeholder={t.phases.work}
              maxLength={MAX_ROUND_NAME_LENGTH}
              autoComplete="off"
              enterKeyHint="next"
              aria-describedby={hintId}
              onChange={(event) => {
                const next = Array.from(
                  { length: Math.max(names.length, index + 1) },
                  (_, round) => names[round] ?? "",
                );
                next[index] = event.target.value;
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
    </details>
  );
}

interface StepperProps {
  field: FieldDefinition;
  value: number;
  onChange: (value: number) => void;
}

function Stepper({ field, value, onChange }: StepperProps) {
  const { t } = useI18n();
  const label = t.fields[field.id];
  const decreased = stepField(field, value, -1);
  const increased = stepField(field, value, 1);

  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <span className={styles.stepperLabel} aria-hidden="true">
        {label}
      </span>
      <div className={styles.stepperControls}>
        <button
          className={styles.stepButton}
          aria-label={t.decrease(label)}
          disabled={decreased === value}
          onClick={() => {
            onChange(decreased);
          }}
        >
          −
        </button>
        <output className={styles.stepperValue}>
          {field.kind === "duration" ? formatClock(value * 1_000) : value}
        </output>
        <button
          className={styles.stepButton}
          aria-label={t.increase(label)}
          disabled={increased === value}
          onClick={() => {
            onChange(increased);
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}
