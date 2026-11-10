import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { HistoryLog } from "../history/application/ports";
import { AuthFailure } from "../auth/domain/user";
import { createFakeHistoryLog } from "../history/infrastructure/fakeHistoryLog";
import { I18nProvider } from "../i18n/ui/I18nProvider";
import type { WorkoutLibrary } from "../workouts/application/ports";
import { createFakeWorkoutLibrary } from "../workouts/infrastructure/fakeWorkoutLibrary";
import { App } from "./App";

interface Stores {
  workouts?: WorkoutLibrary;
  history?: HistoryLog;
  deleteAccount?: () => Promise<void>;
}

function setup({
  workouts = createFakeWorkoutLibrary("test"),
  history = createFakeHistoryLog("test"),
  deleteAccount = () => Promise.resolve(),
}: Stores = {}) {
  let now = 0;
  const timer = {
    clock: { now: () => now },
    cues: { unlock: vi.fn(), play: vi.fn(), vibrate: vi.fn() },
    voice: { unlock: vi.fn(), canSpeak: () => false, say: vi.fn() },
    soundStore: { get: () => null, set: vi.fn() },
    screenAwake: { acquire: vi.fn(), release: vi.fn() },
  };
  const store = { get: () => null, set: vi.fn() };
  render(
    <I18nProvider store={store} browserLanguages={["en-US"]}>
      <App timer={timer} workouts={workouts} history={history} deleteAccount={deleteAccount} />
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

  describe("round names", () => {
    const openRoundNames = () => {
      fireEvent.click(screen.getByText("Round names"));
    };
    const nameRound = (round: number, value: string) => {
      fireEvent.change(screen.getByRole("textbox", { name: `Round ${round}` }), {
        target: { value },
      });
    };
    const phaseHeading = () => screen.getByRole("heading", { level: 1 }).textContent;

    it("offers one name per round, only in modes with rounds", () => {
      setup();
      click(/^Tabata/);
      openRoundNames();
      expect(screen.getAllByRole("textbox", { name: /^Round \d+$/ })).toHaveLength(8);
      expect(screen.getByRole("textbox", { name: "Round 1" })).toHaveAttribute(
        "placeholder",
        "Work",
      );
      click("Decrease Rounds");
      expect(screen.getAllByRole("textbox", { name: /^Round \d+$/ })).toHaveLength(7);

      click(/^AMRAP/);
      expect(screen.queryByText("Round names")).not.toBeInTheDocument();
      click(/^Stopwatch/);
      expect(screen.queryByText("Round names")).not.toBeInTheDocument();
    });

    it("shows and says a named round, and the default names for the rest", () => {
      const app = setup();
      const { timer } = app;
      timer.voice.canSpeak = () => true;
      click("Settings");
      fireEvent.click(screen.getByRole("switch", { name: "Voice announcements" }));
      click("Back");
      click(/^Tabata/);
      openRoundNames();
      nameRound(1, "  Burpees ");
      click(/^Start/);
      expect(screen.getByText("Next: Burpees 00:20")).toBeInTheDocument();

      app.advance(10_000);
      expect(phaseHeading()).toBe("Burpees");
      expect(screen.getByText("Round 1/8")).toBeInTheDocument();
      expect(timer.voice.say).toHaveBeenLastCalledWith("Burpees", "en");
      expect(screen.getByText("Next: Rest 00:10")).toBeInTheDocument();

      app.advance(20_000);
      expect(phaseHeading()).toBe("Rest");
      expect(timer.voice.say).toHaveBeenLastCalledWith("Rest", "en");
      expect(screen.getByText("Next: Work 00:20")).toBeInTheDocument();

      app.advance(10_000);
      expect(phaseHeading()).toBe("Work");
      expect(screen.getByText("Round 2/8")).toBeInTheDocument();
      expect(timer.voice.say).toHaveBeenLastCalledWith("Work", "en");
    });

    it("keeps the default name of an unnamed workout on screen and in the Next line", () => {
      const app = setup();
      click(/^Tabata/);
      click(/^Start/);
      expect(screen.getByText("Next: Work 00:20")).toBeInTheDocument();
      app.advance(10_000);
      expect(phaseHeading()).toBe("Work");
    });

    it("records the names in the history of a finished workout", () => {
      const fake = createFakeHistoryLog("test");
      const add = vi.fn<HistoryLog["add"]>((draft) => fake.add(draft));
      const app = setup({ history: { ...fake, add } });
      click(/^Tabata/);
      openRoundNames();
      nameRound(2, "Squats");
      click(/^Start/);
      app.advance(240_000);
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ roundNames: ["", "Squats"] }) as unknown,
        }),
      );
    });
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
      cues: { unlock: vi.fn(), play: vi.fn(), vibrate: vi.fn() },
      voice: { unlock: vi.fn(), canSpeak: () => false, say: vi.fn() },
      soundStore: { get: () => null, set: vi.fn() },
      screenAwake: { acquire: vi.fn(), release: vi.fn() },
    };
    render(
      <I18nProvider store={{ get: () => "es", set: vi.fn() }} browserLanguages={[]}>
        <App
          timer={timer}
          workouts={createFakeWorkoutLibrary("spanish")}
          history={createFakeHistoryLog("spanish")}
          deleteAccount={() => Promise.resolve()}
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

  it("labels the round names in Spanish", () => {
    render(
      <I18nProvider store={{ get: () => "es", set: vi.fn() }} browserLanguages={[]}>
        <App
          timer={{
            clock: { now: () => 0 },
            cues: { unlock: vi.fn(), play: vi.fn(), vibrate: vi.fn() },
            voice: { unlock: vi.fn(), canSpeak: () => false, say: vi.fn() },
            soundStore: { get: () => null, set: vi.fn() },
            screenAwake: { acquire: vi.fn(), release: vi.fn() },
          }}
          workouts={createFakeWorkoutLibrary("spanish")}
          history={createFakeHistoryLog("spanish")}
          deleteAccount={() => Promise.resolve()}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tabata/ }));
    fireEvent.click(screen.getByText("Nombres de las rondas"));
    expect(screen.getByRole("textbox", { name: "Ronda 1" })).toHaveAttribute(
      "placeholder",
      "Trabajo",
    );
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

  describe("privacy notice", () => {
    it("says what is kept, where, and how to remove it", () => {
      setup();
      click("Privacy");
      const notice = screen.getByRole("main");
      for (const text of [
        /name, email and profile photo/,
        /Firebase/,
        /saved workouts and finished sessions/,
        /stay in this browser after you sign out/,
        /no analytics/i,
        /Delete account/,
      ]) {
        expect(notice).toHaveTextContent(text);
      }
      click("Back");
      expect(screen.getByRole("button", { name: /^Start/ })).toBeInTheDocument();
    });

    it("names who to contact about the data, with a link that writes to them", () => {
      setup();
      click("Privacy");
      const notice = screen.getByRole("main");
      expect(within(notice).getByRole("heading", { name: "Contact" })).toBeInTheDocument();
      expect(
        within(notice).getByRole("link", { name: "carlosngonzalez0@gmail.com" }),
      ).toHaveAttribute("href", "mailto:carlosngonzalez0@gmail.com");
    });
  });

  describe("deleting the account", () => {
    const openScreen = () => {
      click("Delete account");
    };

    it("says what will be lost and deletes nothing until confirmed", () => {
      const deleteAccount = vi.fn(() => Promise.resolve());
      setup({ deleteAccount });
      openScreen();
      expect(screen.getByRole("main")).toHaveTextContent(/cannot be undone/);
      expect(screen.getByRole("main")).toHaveTextContent(/saved workouts/);
      expect(deleteAccount).not.toHaveBeenCalled();

      click("Keep my account");
      expect(screen.getByRole("button", { name: /^Start/ })).toBeInTheDocument();
      expect(deleteAccount).not.toHaveBeenCalled();
    });

    it("deletes once, however many times the button is pressed", () => {
      const deleteAccount = vi.fn(() => new Promise<void>(() => undefined));
      setup({ deleteAccount });
      openScreen();
      click("Delete my account");
      expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Deleting…" }));
      expect(deleteAccount).toHaveBeenCalledOnce();
    });

    it("reports a failure and allows another try", async () => {
      const deleteAccount = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new AuthFailure("network"))
        .mockResolvedValue(undefined);
      setup({ deleteAccount });
      openScreen();
      click("Delete my account");
      await settledCalls();
      expect(screen.getByRole("alert")).toHaveTextContent(/connection/);
      click("Delete my account");
      expect(deleteAccount).toHaveBeenCalledTimes(2);
    });

    it("warns that part of the data may be gone when the failure is not understood", async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      setup({ deleteAccount: () => Promise.reject(new Error("boom")) });
      openScreen();
      click("Delete my account");
      await settledCalls();
      expect(screen.getByRole("alert")).toHaveTextContent(/may already be gone/);
      consoleError.mockRestore();
    });

    it("stays quiet when the user cancels the confirmation", async () => {
      setup({ deleteAccount: () => Promise.reject(new AuthFailure("cancelled")) });
      openScreen();
      click("Delete my account");
      await settledCalls();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete my account" })).toBeEnabled();
    });

    it("recovers the button when the browser restores the page after a redirect", () => {
      setup({ deleteAccount: () => new Promise<void>(() => undefined) });
      openScreen();
      click("Delete my account");
      act(() => {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      expect(screen.getByRole("button", { name: "Delete my account" })).toBeEnabled();
    });
  });

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

    it("saves the round names with the workout and loads them back", () => {
      setup();
      click(/^Tabata/);
      fireEvent.click(screen.getByText("Round names"));
      fireEvent.change(screen.getByRole("textbox", { name: "Round 1" }), {
        target: { value: " Burpees " },
      });
      typeName("Leg day");
      click("Save");

      fireEvent.change(screen.getByRole("textbox", { name: "Round 1" }), {
        target: { value: "" },
      });
      click(/^EMOM/);
      click(/^Leg day/);
      expect(screen.getByRole("button", { name: /^Tabata/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("textbox", { name: "Round 1" })).toHaveValue("Burpees");
      expect(screen.getByRole("textbox", { name: "Round 2" })).toHaveValue("");
    });

    it("does not save a blank name", () => {
      setup();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      typeName("   ");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("deletes a workout only after confirming in the app's own dialog", () => {
      setup();
      typeName("Leg day");
      click("Save");
      const confirm = vi.spyOn(window, "confirm");

      click("Delete Leg day");
      const dialog = screen.getByRole("alertdialog", { name: 'Delete "Leg day"?' });
      expect(dialog).toHaveTextContent("This cannot be undone.");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Leg day/ })).toBeInTheDocument();

      click("Delete Leg day");
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Leg day/ })).not.toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();
      confirm.mockRestore();
    });

    it("closes the dialog with Escape and keeps the workout", () => {
      setup();
      typeName("Leg day");
      click("Save");
      click("Delete Leg day");
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
      fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Leg day/ })).toBeInTheDocument();
    });

    it("tells the user when a save is refused, and the timer still starts", async () => {
      const fake = createFakeWorkoutLibrary("test");
      setup({ workouts: { ...fake, save: () => Promise.reject(new Error("denied")) } });
      typeName("Leg day");
      click("Save");
      await settledCalls();
      expect(screen.getByRole("alert")).toHaveTextContent("couldn't save");
      expect(screen.getByRole("alert")).toHaveTextContent("try again");

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

    it("deletes a finished session only after confirming", () => {
      const { advance } = setup();
      finishStopwatch(advance);
      click("New workout");
      click("History");
      expect(screen.getAllByRole("listitem")).toHaveLength(1);

      click(/^Delete session/);
      const dialog = screen.getByRole("alertdialog", { name: "Delete this session?" });
      expect(dialog).toHaveTextContent("This cannot be undone.");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.getAllByRole("listitem")).toHaveLength(1);

      click(/^Delete session/);
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      expect(screen.getByText("No finished workouts yet.")).toBeInTheDocument();
    });

    it("tells the user when a session cannot be deleted, and keeps it listed", async () => {
      const fake = createFakeHistoryLog("test");
      const { advance } = setup({
        history: { ...fake, remove: () => Promise.reject(new Error("denied")) },
      });
      finishStopwatch(advance);
      click("New workout");
      click("History");
      click(/^Delete session/);
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
      );
      await settledCalls();
      expect(screen.getByRole("alert")).toHaveTextContent("We couldn't delete that session.");
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });

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
      expect(screen.getByRole("alert")).toHaveTextContent("last session");
      expect(screen.getByRole("alert")).not.toHaveTextContent("try again");
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

describe("sound settings", () => {
  const openSettings = () => {
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Sound settings" })).toBeVisible();
  };
  const option = (name: string) => screen.getByRole("switch", { name });

  it("lists every option, starting with the voice off and its own options unavailable", () => {
    setup();
    openSettings();
    expect(option("Voice announcements")).not.toBeChecked();
    for (const name of ["10 seconds left", "Halfway", "Interval name"]) {
      expect(option(name)).toBeDisabled();
    }
    expect(option("3-2-1 countdown")).toBeEnabled();
    expect(option("3-2-1 countdown")).toBeChecked();
    expect(option("Interval sound")).toBeEnabled();
    expect(option("Interval sound")).toBeChecked();
  });

  it("saves a change at once and enables the voice's own options", () => {
    const { timer } = setup();
    openSettings();
    fireEvent.click(option("Voice announcements"));
    expect(timer.soundStore.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ voice: true, halfway: true }),
    );
    expect(option("Halfway")).toBeEnabled();
    fireEvent.click(option("Halfway"));
    expect(timer.soundStore.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ voice: true, halfway: false }),
    );
  });

  it("warns when the voice is on but this browser cannot speak the app's language", () => {
    const { timer } = setup();
    openSettings();
    const warning = /no voice for this language/;
    expect(screen.queryByText(warning)).toBeNull();
    fireEvent.click(option("Voice announcements"));
    expect(screen.getByRole("status")).toHaveTextContent(warning);

    timer.voice.canSpeak = () => true;
    fireEvent.click(option("Halfway"));
    expect(screen.queryByText(warning)).toBeNull();
  });

  it("starts a workout with the settings chosen, spoken in the app's language", () => {
    const { timer } = setup();
    timer.voice.canSpeak = () => true;
    openSettings();
    fireEvent.click(option("Voice announcements"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: /^Start/ }));
    expect(timer.voice.say).toHaveBeenLastCalledWith("Get ready", "en");
  });
});
