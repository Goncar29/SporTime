import type { WorkoutMode } from "../../workouts/domain/workout";
import type { Phase, PhaseKind, Timeline } from "../../workouts/domain/timeline";
import type { TimerController, TimerView } from "../application/timerController";
import { formatClock } from "../domain/format";
import styles from "./TimerScreen.module.css";
import { useTimerView } from "./useTimerView";

const PHASE_LABELS: Record<PhaseKind, string> = {
  prepare: "Get ready",
  work: "Work",
  rest: "Rest",
  setRest: "Rest between sets",
};

const MARK_ACTIONS: Partial<Record<WorkoutMode, { action: string; count: string }>> = {
  stopwatch: { action: "Lap", count: "Laps" },
  amrap: { action: "+1 Round", count: "Rounds" },
};

const FINAL_COUNTDOWN_MS = 3_000;

interface TimerScreenProps {
  mode: WorkoutMode;
  timeline: Timeline;
  controller: TimerController;
  onExit(): void;
}

export function TimerScreen({ mode, timeline, controller, onExit }: TimerScreenProps) {
  const view = useTimerView(controller);

  if (view.status === "finished") {
    return (
      <FinishedSummary
        mode={mode}
        timeline={timeline}
        view={view}
        onAgain={() => {
          controller.reset();
          controller.start();
        }}
        onExit={onExit}
      />
    );
  }

  return (
    <ActiveTimer
      mode={mode}
      next={timeline.phases[view.phaseIndex + 1]}
      view={view}
      onPause={controller.pause}
      onResume={controller.resume}
      onSkip={controller.skip}
      onMark={controller.mark}
      onExit={onExit}
    />
  );
}

interface ActiveTimerProps {
  mode: WorkoutMode;
  next: Phase | undefined;
  view: TimerView;
  onPause(): void;
  onResume(): void;
  onSkip(): void;
  onMark(): void;
  onExit(): void;
}

function ActiveTimer({
  mode,
  next,
  view,
  onPause,
  onResume,
  onSkip,
  onMark,
  onExit,
}: ActiveTimerProps) {
  const { phase, phaseElapsedMs, phaseRemainingMs, status, marks } = view;
  const paused = status === "paused";
  const markAction = phase.kind === "work" ? MARK_ACTIONS[mode] : undefined;
  const openEnded = phase.durationMs === null;

  const clock =
    phase.display === "countdown"
      ? formatClock(phaseRemainingMs ?? 0, "ceil")
      : formatClock(phaseElapsedMs);
  const progress = phase.durationMs ? Math.min(1, phaseElapsedMs / phase.durationMs) : 0;
  const finalSeconds =
    !paused && phaseRemainingMs !== null && phaseRemainingMs <= FINAL_COUNTDOWN_MS
      ? Math.ceil(phaseRemainingMs / 1_000)
      : null;

  return (
    <main className={styles.screen} data-phase={phase.kind} data-paused={paused}>
      {/* Remounting per phase restarts the entrance flash and resets the bar without animating it backwards. */}
      <div key={view.phaseIndex} className={styles.phaseLayer} aria-hidden="true">
        {!openEnded && (
          <div className={styles.progress} style={{ transform: `scaleX(${progress})` }} />
        )}
        <div className={styles.flash} />
      </div>

      <header className={styles.header}>
        <h1 className={styles.phaseLabel}>{paused ? "Paused" : PHASE_LABELS[phase.kind]}</h1>
        {paused && <span className={styles.visuallyHidden}>{PHASE_LABELS[phase.kind]}</span>}
        <p className={styles.counters}>
          {phase.totalRounds > 1 && <span>{`Round ${phase.round}/${phase.totalRounds}`}</span>}
          {phase.totalSets > 1 && <span>{`Set ${phase.set}/${phase.totalSets}`}</span>}
          {MARK_ACTIONS[mode] && marks.length > 0 && (
            <span>{`${MARK_ACTIONS[mode].count}: ${marks.length}`}</span>
          )}
        </p>
      </header>

      <div className={styles.clockArea}>
        <div
          key={finalSeconds ?? "steady"}
          role="timer"
          className={`${styles.clock} ${clock.length > 5 ? styles.clockLong : ""} ${finalSeconds ? styles.pulse : ""}`}
        >
          {clock}
        </div>
        {next && (
          <p
            className={styles.next}
          >{`Next: ${PHASE_LABELS[next.kind]}${next.durationMs ? ` ${formatClock(next.durationMs)}` : ""}`}</p>
        )}
      </div>

      <footer className={styles.controls}>
        {paused ? (
          <>
            <button className={styles.primary} onClick={onResume}>
              Resume
            </button>
            <button className={styles.secondary} onClick={onExit}>
              Exit
            </button>
          </>
        ) : (
          <button className={styles.primary} onClick={onPause}>
            Pause
          </button>
        )}
        {markAction && !paused && (
          <button className={styles.secondary} onClick={onMark}>
            {markAction.action}
          </button>
        )}
        <button className={styles.secondary} onClick={onSkip}>
          {phase.display === "countup" ? "Finish" : "Skip"}
        </button>
      </footer>
    </main>
  );
}

interface FinishedSummaryProps {
  mode: WorkoutMode;
  timeline: Timeline;
  view: TimerView;
  onAgain(): void;
  onExit(): void;
}

function FinishedSummary({ mode, timeline, view, onAgain, onExit }: FinishedSummaryProps) {
  const markAction = MARK_ACTIONS[mode];
  return (
    <main className={styles.screen} data-phase="finished">
      <section className={styles.summary} aria-label="Workout complete">
        <h1 className={styles.summaryTitle}>Done!</h1>
        <p className={styles.summaryCaption}>Total time</p>
        <p className={`${styles.clock} ${styles.summaryClock}`}>
          {formatClock(view.activeElapsedMs)}
        </p>
        {markAction && (
          <p className={styles.summaryStat}>{`${markAction.count}: ${view.marks.length}`}</p>
        )}
        {mode === "forTime" && view.marks.length > 0 && (
          <ul className={styles.summaryList}>
            {view.marks.map((mark) => {
              const set = timeline.phases[mark.phaseIndex]?.set;
              return (
                <li key={mark.phaseIndex}>{`Set ${set}: ${formatClock(mark.phaseElapsedMs)}`}</li>
              );
            })}
          </ul>
        )}
      </section>
      <footer className={styles.controls}>
        <button className={styles.primary} onClick={onAgain}>
          Go again
        </button>
        <button className={styles.secondary} onClick={onExit}>
          New workout
        </button>
      </footer>
    </main>
  );
}
