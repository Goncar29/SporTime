import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HistoryLog } from "../history/application/ports";
import { createFakeHistoryLog } from "../history/infrastructure/fakeHistoryLog";
import { I18nProvider } from "../i18n/ui/I18nProvider";
import type { WorkoutLibrary } from "../workouts/application/ports";
import { createFakeWorkoutLibrary } from "../workouts/infrastructure/fakeWorkoutLibrary";
import { App } from "./App";

interface Stores {
  workouts?: WorkoutLibrary;
  history?: HistoryLog;
}

function setup({
  workouts = createFakeWorkoutLibrary("test"),
  history = createFakeHistoryLog("test"),
}: Stores = {}) {
  let now = 0;
  const timer = {
    clock: { now: () => now },
    cues: { unlock: vi.fn(), play: vi.fn() },
    screenAwake: { acquire: vi.fn(), release: vi.fn() },
  };
  const store = { get: () => null, set: vi.fn() };
  render(
    <I18nProvider store={store} browserLanguages={["en-US"]}>
      <App timer={timer} workouts={workouts} history={history} />
    </I18nProvider>,
  );
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
    localStorage.clear();
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

describe("App in Spanish", () => {
  it("translates the setup and a running workout", () => {
    vi.useFakeTimers();
    const timer = {
      clock: { now: () => 0 },
      cues: { unlock: vi.fn(), play: vi.fn() },
      screenAwake: { acquire: vi.fn(), release: vi.fn() },
    };
    render(
      <I18nProvider store={{ get: () => "es", set: vi.fn() }} browserLanguages={[]}>
        <App
          timer={timer}
          workouts={createFakeWorkoutLibrary("spanish")}
          history={createFakeHistoryLog("spanish")}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Cronómetro/ }));
    expect(screen.getByRole("button", { name: /^Iniciar/ })).toHaveTextContent("Sin límite");

    fireEvent.click(screen.getByRole("button", { name: /^Tabata/ }));
    expect(screen.getByRole("group", { name: "Rondas" })).toHaveTextContent("8");
    fireEvent.click(screen.getByRole("button", { name: "Aumentar Rondas" }));
    fireEvent.click(screen.getByRole("button", { name: /^Iniciar/ }));
    expect(screen.getByText("Prepárate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("App account data", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const nameInput = () => screen.getByRole("textbox", { name: "Workout name" });
  const typeName = (value: string) => {
    fireEvent.change(nameInput(), { target: { value } });
  };
  const settledCalls = () => act(() => vi.advanceTimersByTimeAsync(0));
  const fieldValue = (name: string) =>
    within(screen.getByRole("group", { name })).getByRole("status").textContent;

  describe("while the account data has not answered", () => {
    const silent = () => () => undefined;

    it("shows no empty message for saved workouts", () => {
      setup({ workouts: { ...createFakeWorkoutLibrary("test"), subscribe: silent } });
      expect(screen.queryByText(/Save your settings here/)).not.toBeInTheDocument();
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });

    it("shows no empty message for the history", () => {
      setup({ history: { ...createFakeHistoryLog("test"), subscribe: silent } });
      click("History");
      expect(screen.queryByText("No finished workouts yet.")).not.toBeInTheDocument();
      expect(screen.getByText("Loading…")).toBeInTheDocument();
    });
  });

  describe("saved workouts", () => {
    it("saves the current settings under a name and loads them back", () => {
      setup();
      click(/^EMOM/);
      click("Increase Rounds");
      typeName("  Morning EMOM ");
      click("Save");
      expect(nameInput()).toHaveValue("");

      click(/^Tabata/);
      click(/^Morning EMOM/);
      expect(screen.getByRole("button", { name: /^EMOM/ })).toHaveAttribute("aria-pressed", "true");
      expect(fieldValue("Rounds")).toBe("11");
    });

    it("does not save a blank name", () => {
      setup();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      typeName("   ");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("deletes a workout only after confirming", () => {
      setup();
      typeName("Leg day");
      click("Save");
      const confirm = vi.spyOn(window, "confirm");

      confirm.mockReturnValueOnce(false);
      click("Delete Leg day");
      expect(screen.getByRole("button", { name: /^Leg day/ })).toBeInTheDocument();

      confirm.mockReturnValueOnce(true);
      click("Delete Leg day");
      expect(screen.queryByRole("button", { name: /^Leg day/ })).not.toBeInTheDocument();
      confirm.mockRestore();
    });

    it("tells the user when a save is refused, and the timer still starts", async () => {
      const fake = createFakeWorkoutLibrary("test");
      setup({ workouts: { ...fake, save: () => Promise.reject(new Error("denied")) } });
      typeName("Leg day");
      click("Save");
      await settledCalls();
      expect(screen.getByRole("alert")).toHaveTextContent("couldn't save");

      click(/^Start/);
      expect(screen.getByRole("timer")).toBeInTheDocument();
    });

    it("tells the user when saved workouts cannot be read", () => {
      const fake = createFakeWorkoutLibrary("test");
      setup({
        workouts: {
          ...fake,
          subscribe(_onData, onError) {
            onError(new Error("denied"));
            return () => undefined;
          },
        },
      });
      expect(screen.getByRole("alert")).toHaveTextContent("couldn't load");
    });

    it("does not wait for the server, which never answers offline", () => {
      const fake = createFakeWorkoutLibrary("test");
      setup({
        workouts: {
          ...fake,
          save(draft) {
            void fake.save(draft);
            return new Promise(() => undefined);
          },
        },
      });
      typeName("Leg day");
      click("Save");
      expect(screen.getByRole("button", { name: /^Leg day/ })).toBeInTheDocument();
      expect(nameInput()).toHaveValue("");
    });
  });

  describe("history", () => {
    const finishStopwatch = (advance: (ms: number) => void) => {
      click(/^Stopwatch/);
      click(/^Start/);
      advance(65_000);
      click("Finish");
    };

    it("starts empty", () => {
      setup();
      click("History");
      expect(screen.getByText("No finished workouts yet.")).toBeInTheDocument();
    });

    it("lists a finished workout with its mode, time and laps", () => {
      const { advance } = setup();
      click(/^Stopwatch/);
      click(/^Start/);
      advance(5_000);
      click("Lap");
      advance(60_000);
      click("Finish");
      click("New workout");

      click("History");
      const [entry] = screen.getAllByRole("listitem");
      expect(entry).toHaveTextContent("Stopwatch");
      expect(entry).toHaveTextContent("1:05");
      expect(entry).toHaveTextContent("Laps: 1");
    });

    it("records nothing when leaving a workout early", () => {
      const { advance } = setup();
      click(/^Stopwatch/);
      click(/^Start/);
      advance(5_000);
      click("Pause");
      click("Exit");

      click("History");
      expect(screen.getByText("No finished workouts yet.")).toBeInTheDocument();
    });

    it("records each repeat of a workout", () => {
      const { advance } = setup();
      finishStopwatch(advance);
      click("Go again");
      advance(1_000);
      click("Finish");
      click("New workout");

      click("History");
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });

    it("returns to the setup screen", () => {
      setup();
      click("History");
      click("Back");
      expect(screen.getByRole("button", { name: /^Start/ })).toBeInTheDocument();
    });

    it("keeps the finished screen and warns afterwards when the entry is refused", async () => {
      const fake = createFakeHistoryLog("test");
      const { advance } = setup({
        history: { ...fake, add: () => Promise.reject(new Error("denied")) },
      });
      finishStopwatch(advance);
      await settledCalls();
      expect(screen.getByRole("region", { name: "Workout complete" })).toBeInTheDocument();
      click("New workout");
      expect(screen.getByRole("alert")).toHaveTextContent("couldn't save");
    });

    it("tells the user when the history cannot be read", () => {
      const fake = createFakeHistoryLog("test");
      setup({
        history: {
          ...fake,
          subscribe(_onData, onError) {
            onError(new Error("denied"));
            return () => undefined;
          },
        },
      });
      click("History");
      expect(screen.getByRole("alert")).toHaveTextContent("couldn't load");
    });
  });
});
