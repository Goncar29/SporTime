import { formatClock } from "../../timer/domain/format";
import { buildTimeline } from "../domain/timeline";
import {
  MODES,
  modeDefinition,
  stepField,
  type FieldDefinition,
  type WorkoutConfig,
  type WorkoutMode,
} from "../domain/workout";
import styles from "./WorkoutSetup.module.css";

interface WorkoutSetupProps {
  config: WorkoutConfig;
  onSelectMode(mode: WorkoutMode): void;
  onChange(config: WorkoutConfig): void;
  onStart(): void;
}

export function WorkoutSetup({ config, onSelectMode, onChange, onStart }: WorkoutSetupProps) {
  const { totalMs } = buildTimeline(config);
  const definition = modeDefinition(config.mode);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.brand}>Sportime</h1>
        <p className={styles.tagline}>Pick your fight.</p>
      </header>

      <div className={styles.modes}>
        {MODES.map((mode) => (
          <button
            key={mode.id}
            className={styles.mode}
            aria-pressed={mode.id === config.mode}
            onClick={() => {
              onSelectMode(mode.id);
            }}
          >
            <span className={styles.modeLabel}>{mode.label}</span>
            <span className={styles.modeDescription}>{mode.description}</span>
          </button>
        ))}
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

      <div className={styles.startBar}>
        <button className={styles.start} onClick={onStart}>
          <span>Start</span>
          <span className={styles.startTotal}>
            {totalMs === null ? "No limit" : formatClock(totalMs)}
          </span>
        </button>
      </div>
    </main>
  );
}

interface StepperProps {
  field: FieldDefinition;
  value: number;
  onChange(value: number): void;
}

function Stepper({ field, value, onChange }: StepperProps) {
  const decreased = stepField(field, value, -1);
  const increased = stepField(field, value, 1);

  return (
    <div className={styles.stepper} role="group" aria-label={field.label}>
      <span className={styles.stepperLabel} aria-hidden="true">
        {field.label}
      </span>
      <div className={styles.stepperControls}>
        <button
          className={styles.stepButton}
          aria-label={`Decrease ${field.label}`}
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
          aria-label={`Increase ${field.label}`}
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
