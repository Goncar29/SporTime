import { useI18n } from "../../i18n/ui/I18nProvider";
import type { Phase, Timeline } from "../../workouts/domain/timeline";
import type { WorkoutMode } from "../../workouts/domain/workout";
import type { TimerController, TimerView } from "../application/timerController";
import { formatClock } from "../domain/format";
import styles from "./TimerScreen.module.css";
import { useTimerView } from "./useTimerView";

const MARK_KINDS: Partial<Record<WorkoutMode, "lapMark" | "roundMark">> = {
  stopwatch: "lapMark",
  amrap: "roundMark",
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
  const { t } = useI18n();
  const { phase, phaseElapsedMs, phaseRemainingMs, status, marks } = view;
  const paused = status === "paused";
  const markKind = MARK_KINDS[mode];
  const mark = markKind && t[markKind];
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
  const nextLabel =
    next &&
    t.next(
      next.durationMs
        ? `${t.phases[next.kind]} ${formatClock(next.durationMs)}`
        : t.phases[next.kind],
    );

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
        <h1 className={styles.phaseLabel}>{paused ? t.paused : t.phases[phase.kind]}</h1>
        {paused && <span className={styles.visuallyHidden}>{t.phases[phase.kind]}</span>}
        <p className={styles.counters}>
          {phase.totalRounds > 1 && <span>{t.round(phase.round, phase.totalRounds)}</span>}
          {phase.totalSets > 1 && <span>{t.set(phase.set, phase.totalSets)}</span>}
          {mark && marks.length > 0 && <span>{mark.count(marks.length)}</span>}
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
        {nextLabel && <p className={styles.next}>{nextLabel}</p>}
      </div>

      <footer className={styles.controls}>
        {paused ? (
          <>
            <button className={styles.primary} onClick={onResume}>
              {t.resume}
            </button>
            <button className={styles.secondary} onClick={onExit}>
              {t.exit}
            </button>
          </>
        ) : (
          <button className={styles.primary} onClick={onPause}>
            {t.pause}
          </button>
        )}
        {mark && phase.kind === "work" && !paused && (
          <button className={styles.secondary} onClick={onMark}>
            {mark.action}
          </button>
        )}
        <button className={styles.secondary} onClick={onSkip}>
          {phase.display === "countup" ? t.finish : t.skip}
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
  const { t } = useI18n();
  const markKind = MARK_KINDS[mode];
  const mark = markKind && t[markKind];

  return (
    <main className={styles.screen} data-phase="finished">
      <section className={styles.summary} aria-label={t.workoutComplete}>
        <h1 className={styles.summaryTitle}>{t.done}</h1>
        <p className={styles.summaryCaption}>{t.totalTime}</p>
        <p className={`${styles.clock} ${styles.summaryClock}`}>
          {formatClock(view.activeElapsedMs)}
        </p>
        {mark && <p className={styles.summaryStat}>{mark.count(view.marks.length)}</p>}
        {mode === "forTime" && view.marks.length > 0 && (
          <ul className={styles.summaryList}>
            {view.marks.map((result) => {
              const set = timeline.phases[result.phaseIndex]?.set ?? 1;
              return (
                <li key={result.phaseIndex}>
                  {t.setResult(set, formatClock(result.phaseElapsedMs))}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <footer className={styles.controls}>
        <button className={styles.primary} onClick={onAgain}>
          {t.goAgain}
        </button>
        <button className={styles.secondary} onClick={onExit}>
          {t.newWorkout}
        </button>
      </footer>
    </main>
  );
}
