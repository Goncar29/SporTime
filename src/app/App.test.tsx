import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./App";

function setup() {
  let now = 0;
  const timer = {
    clock: { now: () => now },
    cues: { unlock: vi.fn(), play: vi.fn() },
    screenAwake: { acquire: vi.fn(), release: vi.fn() },
  };
  render(<App timer={timer} />);
  return {
    timer,
    advance(ms: number) {
      act(() => {
        now += ms;
        vi.advanceTimersByTime(100);
      });
    },
  };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const clock = () => screen.getByRole("timer").textContent;

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers every workout mode", () => {
    setup();
    for (const label of ["Stopwatch", "For Time", "AMRAP", "EMOM", "Tabata", "Intervals"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it("shows the settings and total time of the selected mode", () => {
    setup();
    click(/^Tabata/);
    expect(screen.getByRole("group", { name: "Work" })).toHaveTextContent("00:20");
    expect(screen.getByRole("group", { name: "Rest" })).toHaveTextContent("00:10");
    expect(screen.getByRole("group", { name: "Rounds" })).toHaveTextContent("8");
    expect(screen.getByRole("button", { name: /^Start/ })).toHaveTextContent("04:00");
  });

  it("updates the total when a setting changes", () => {
    setup();
    click(/^Tabata/);
    click("Increase Rounds");
    expect(screen.getByRole("group", { name: "Rounds" })).toHaveTextContent("9");
    expect(screen.getByRole("button", { name: /^Start/ })).toHaveTextContent("04:30");
  });

  it("allows removing rest entirely but never going below the minimum", () => {
    setup();
    click(/^Tabata/);
    click("Decrease Rest");
    click("Decrease Rest");
    expect(screen.getByRole("group", { name: "Rest" })).toHaveTextContent("00:00");
    expect(screen.getByRole("button", { name: "Decrease Rest" })).toBeDisabled();
  });

  it("keeps each mode settings when switching between modes", () => {
    setup();
    click(/^Tabata/);
    click("Increase Rounds");
    click(/^AMRAP/);
    click(/^Tabata/);
    expect(screen.getByRole("group", { name: "Rounds" })).toHaveTextContent("9");
  });

  it("a stopwatch has no time limit", () => {
    setup();
    click(/^Stopwatch/);
    expect(screen.getByRole("button", { name: /^Start/ })).toHaveTextContent("No limit");
  });

  it("starting runs the workout phase by phase from the user gesture", () => {
    const { timer, advance } = setup();
    click(/^Tabata/);
    click(/^Start/);
    expect(timer.cues.unlock).toHaveBeenCalledOnce();
    expect(timer.screenAwake.acquire).toHaveBeenCalledOnce();
    expect(screen.getByText("Get ready")).toBeInTheDocument();
    expect(clock()).toBe("00:10");

    advance(10_000);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(clock()).toBe("00:20");
    expect(screen.getByText("Round 1/8")).toBeInTheDocument();

    advance(20_000);
    expect(screen.getByText("Rest")).toBeInTheDocument();
    expect(clock()).toBe("00:10");
  });

  it("pausing freezes the time and is the only way to exit", () => {
    const { advance } = setup();
    click(/^Tabata/);
    click(/^Start/);
    expect(screen.queryByRole("button", { name: "Exit" })).not.toBeInTheDocument();

    click("Pause");
    advance(5_000);
    expect(clock()).toBe("00:10");

    click("Resume");
    advance(1_000);
    expect(clock()).toBe("00:09");

    click("Pause");
    click("Exit");
    expect(screen.getByRole("button", { name: /^Start/ })).toBeInTheDocument();
  });

  it("AMRAP counts the rounds completed", () => {
    const { advance } = setup();
    click(/^AMRAP/);
    click(/^Start/);
    advance(10_000);
    click("+1 Round");
    click("+1 Round");
    expect(screen.getByText("Rounds: 2")).toBeInTheDocument();
  });

  it("finishing a stopwatch reports the time and laps", () => {
    const { advance } = setup();
    click(/^Stopwatch/);
    click(/^Start/);
    advance(3_000);
    click("Lap");
    advance(2_000);
    click("Finish");

    const summary = screen.getByRole("region", { name: "Workout complete" });
    expect(within(summary).getByText("00:05")).toBeInTheDocument();
    expect(within(summary).getByText("Laps: 1")).toBeInTheDocument();
  });

  it("runs to completion, then can start again or go back", () => {
    const { timer, advance } = setup();
    click(/^Tabata/);
    click(/^Start/);
    advance(240_000);
    expect(screen.getByRole("region", { name: "Workout complete" })).toHaveTextContent("03:50");
    expect(timer.cues.play).toHaveBeenLastCalledWith("finish");
    expect(timer.screenAwake.release).toHaveBeenCalled();

    click("Go again");
    expect(clock()).toBe("00:10");

    click("Pause");
    click("Exit");
    expect(screen.getByRole("button", { name: /^Start/ })).toBeInTheDocument();
  });
});
