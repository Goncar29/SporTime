import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../i18n/ui/I18nProvider";
import { RoutineView } from "./RoutineView";

it("shows a stage's table in Spanish, with the weight's decimal comma", () => {
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["es-AR"]}>
      <RoutineView
        routine={{
          id: "r1",
          name: "Empuje",
          createdAt: 1_000,
          stages: [
            {
              exercises: [
                {
                  name: "Press banca",
                  repsMin: 8,
                  repsMax: 10,
                  restSeconds: 90,
                  weight: 62.5,
                  weightUnit: "kg",
                },
              ],
            },
          ],
        }}
        errors={[]}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    </I18nProvider>,
  );
  const table = screen.getByRole("table", { name: "Etapa 1" });
  for (const name of ["Ejercicio", "Repeticiones", "Pausa", "Peso"]) {
    expect(within(table).getByRole("columnheader", { name })).toBeInTheDocument();
  }
  // A phone too narrow for "Repeticiones" shows "Reps"; screen readers keep the full word.
  const reps = within(table).getByRole("columnheader", { name: "Repeticiones" });
  expect(within(reps).getByText("Reps")).toHaveAttribute("aria-hidden", "true");
  expect(
    within(table)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["Press banca", "8 - 10", "90''", "62,5 kg"]);
  expect(screen.getByRole("button", { name: "Editar \u2068Empuje\u2069" })).toBeInTheDocument();
});

it("isolates every text the routine holds, so none can reorder what is around it (L62)", () => {
  const onShare = vi.fn();
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["es-AR"]}>
      <RoutineView
        routine={{
          id: "r1",
          name: "\u202eEmpuje",
          notes: "Calentar",
          createdAt: 1_000,
          stages: [
            {
              name: "Bloque",
              notes: "Sin prisa",
              exercises: [
                {
                  name: "Press",
                  repsMin: 8,
                  notes: "Lento",
                  link: "https://www.youtube.com/watch?v=abc",
                },
              ],
            },
          ],
        }}
        errors={[]}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onShare={onShare}
      />
    </I18nProvider>,
  );
  const title = screen.getByRole("heading", { level: 1 });
  expect(title.textContent).toBe("\u202eEmpuje");
  expect(title.querySelector("bdi")?.textContent).toBe("\u202eEmpuje");
  for (const text of ["Calentar", "Bloque", "Sin prisa", "Press", "Lento"]) {
    expect(screen.getByText(text).tagName, text).toBe("BDI");
  }
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Bloque");
  expect(screen.getByRole("table", { name: "Bloque" })).toBeInTheDocument();
  for (const name of ["Editar", "Eliminar", "Compartir"]) {
    expect(screen.getByRole("button", { name: `${name} \u2068Empuje\u2069` })).toBeInTheDocument();
  }
  expect(
    screen.getByRole("link", { name: "Ver youtube.com (\u2068Press\u2069)" }).textContent,
  ).toBe("Ver");
  fireEvent.click(screen.getByRole("button", { name: "Eliminar \u2068Empuje\u2069" }));
  expect(
    screen.getByRole("alertdialog", { name: '¿Eliminar "\u2068Empuje\u2069"?' }),
  ).toBeInTheDocument();
});

/** A cell as screen readers read it, without the short header only narrow phones show. */
const spokenText = (cell: HTMLElement) => {
  const copy = cell.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => {
    hidden.remove();
  });
  return copy.textContent;
};

const renderSpanish = (stages: Parameters<typeof RoutineView>[0]["routine"]["stages"]) =>
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["es-AR"]}>
      <RoutineView
        routine={{ id: "r1", name: "Empuje", createdAt: 1_000, stages }}
        errors={[]}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    </I18nProvider>,
  );

it("ends an exercise's row with a Ver button for its link, and leaves the cell empty without one", () => {
  renderSpanish([
    {
      exercises: [
        { name: "Press banca", repsMin: 10, link: "https://www.youtube.com/watch?v=abc" },
        { name: "Remo", repsMin: 8, notes: "Lento" },
      ],
    },
  ]);
  const table = screen.getByRole("table", { name: "Etapa 1" });
  expect(within(table).getAllByRole("columnheader").map(spokenText)).toEqual([
    "Ejercicio",
    "Repeticiones",
    "Enlace",
  ]);
  const link = within(table).getByRole("link", {
    name: "Ver youtube.com (\u2068Press banca\u2069)",
  });
  expect(link.textContent).toBe("Ver");
  expect(link).toHaveAttribute("title", "youtube.com");
  expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const rows = within(table).getAllByRole("row");
  // Header, Press banca, Remo, Remo's notes below it.
  expect(
    rows.map((row) => [...row.children].map((cell) => spokenText(cell as HTMLElement))),
  ).toEqual([
    ["Ejercicio", "Repeticiones", "Enlace"],
    ["Press banca", "10", "Ver"],
    ["Remo", "8", ""],
    ["Lento"],
  ]);
  expect(rows[1]).toContainElement(link);
});

it("names the link without an exercise name by its site only", () => {
  renderSpanish([{ exercises: [{ repsMin: 10, link: "https://youtu.be/abc" }] }]);
  const link = screen.getByRole("link", { name: "Ver youtu.be" });
  expect(link.textContent).toBe("Ver");
});

it("has no link column for a stage where no exercise has a safe link", () => {
  renderSpanish([
    { exercises: [{ name: "Press banca", link: "https://youtu.be/abc" }] },
    {
      exercises: [
        { name: "Remo", repsMin: 8 },
        { name: "Curl", link: "javascript:alert(1)" },
      ],
    },
  ]);
  expect(
    within(screen.getByRole("table", { name: "Etapa 1" }))
      .getAllByRole("columnheader")
      .map(spokenText),
  ).toEqual(["Ejercicio", "Enlace"]);
  const second = screen.getByRole("table", { name: "Etapa 2" });
  expect(within(second).getAllByRole("columnheader").map(spokenText)).toEqual([
    "Ejercicio",
    "Repeticiones",
  ]);
  expect(within(second).queryByRole("link")).not.toBeInTheDocument();
  expect(
    within(second)
      .getAllByRole("row")
      .map((row) => row.children.length),
  ).toEqual([2, 2, 2]);
});

it("shows no Ver button for a stored link to the local network or an IP address", () => {
  renderSpanish([
    {
      exercises: [
        { name: "Remo", repsMin: 8, link: "https://192.168.0.1/video" },
        { name: "Curl", link: "https://router/admin" },
      ],
    },
  ]);
  const table = screen.getByRole("table", { name: "Etapa 1" });
  expect(within(table).queryByRole("link")).not.toBeInTheDocument();
  expect(within(table).getAllByRole("columnheader").map(spokenText)).toEqual([
    "Ejercicio",
    "Repeticiones",
  ]);
});

it("offers Compartir only when sharing is possible, and hands it the routine", () => {
  const onShare = vi.fn();
  const routine = { id: "r1", name: "Piernas", createdAt: 1_000, stages: [] };
  const view = (share?: typeof onShare) => (
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["es-AR"]}>
      <RoutineView
        routine={routine}
        errors={[]}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onShare={share}
      />
    </I18nProvider>
  );
  const { rerender } = render(view());
  expect(
    screen.queryByRole("button", { name: "Compartir \u2068Piernas\u2069" }),
  ).not.toBeInTheDocument();
  rerender(view(onShare));
  const button = screen.getByRole("button", { name: "Compartir \u2068Piernas\u2069" });
  expect(button.textContent).toBe("Compartir");
  button.click();
  expect(onShare).toHaveBeenCalledWith(routine);
});

describe("a routine received from a contact (T26, S12)", () => {
  const receivedRoutine = (receivedFrom?: { uid: string; name: string; email: string }) => ({
    id: "r1",
    name: "Piernas",
    createdAt: 1_000,
    stages: [],
    ...(receivedFrom === undefined ? {} : { receivedFrom }),
  });

  const renderIn = (language: "en-US" | "es-AR", routine: ReturnType<typeof receivedRoutine>) => {
    const onEdit = vi.fn();
    render(
      <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={[language]}>
        <RoutineView
          routine={routine}
          errors={[]}
          onBack={vi.fn()}
          onEdit={onEdit}
          onRemove={vi.fn()}
        />
      </I18nProvider>,
    );
    return { onEdit };
  };

  it("says who sent it, with the name isolated and the email always shown", () => {
    renderIn("es-AR", receivedRoutine({ uid: "ana", name: "Ana", email: "ana@example.com" }));
    const sender = screen.getByText("Recibida de \u2068Ana\u2069 (\u2068ana@example.com\u2069)");
    expect(sender.tagName).toBe("BDI");
  });

  it("says it in English too", () => {
    renderIn("en-US", receivedRoutine({ uid: "ana", name: "Ana", email: "ana@example.com" }));
    expect(
      screen.getByText("Received from \u2068Ana\u2069 (\u2068ana@example.com\u2069)"),
    ).toBeInTheDocument();
  });

  it("shows only the email when the sender has no name, or one that shows nothing", () => {
    renderIn("es-AR", receivedRoutine({ uid: "ana", name: " \u200b ", email: "ana@example.com" }));
    expect(screen.getByText("Recibida de \u2068ana@example.com\u2069")).toBeInTheDocument();
  });

  it("keeps a name with bidi controls from reordering the email around it", () => {
    renderIn(
      "en-US",
      receivedRoutine({ uid: "ana", name: "\u202eecilA", email: "ana@example.com" }),
    );
    expect(
      screen.getByText("Received from \u2068ecilA\u2069 (\u2068ana@example.com\u2069)"),
    ).toBeInTheDocument();
  });

  it("is the user's own to edit, sender included", () => {
    const routine = receivedRoutine({ uid: "ana", name: "Ana", email: "ana@example.com" });
    const { onEdit } = renderIn("en-US", routine);
    fireEvent.click(screen.getByRole("button", { name: "Edit \u2068Piernas\u2069" }));
    expect(onEdit).toHaveBeenCalledWith(routine);
  });

  it("says nothing about a sender on the user's own routines", () => {
    renderIn("en-US", receivedRoutine());
    expect(screen.queryByText(/Received from/)).not.toBeInTheDocument();
  });
});

const BIDI_CONTROL = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** Each U+2068 closes at its own U+2069 with no bidi control inside, and none is left outside. */
function expectSealed(text: string | null) {
  const outside = (text ?? "").replace(
    /\u2068[^\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]*\u2069/gu,
    "",
  );
  expect(outside).not.toMatch(BIDI_CONTROL);
}

it("keeps texts with a stray isolate end from reordering labels, dialog and sender (L64 B1)", () => {
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["es-AR"]}>
      <RoutineView
        routine={{
          id: "c9",
          name: "Piernas\u2069\u202e",
          createdAt: 1,
          stages: [
            {
              exercises: [
                { name: "Press\u2069\u202e", repsMin: 8, link: "https://www.youtube.com/x" },
              ],
            },
          ],
          receivedFrom: { uid: "ana", name: "Ana\u2069\u202e", email: "ana@example.com" },
        }}
        errors={[]}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onShare={vi.fn()}
      />
    </I18nProvider>,
  );
  const labels = [...document.querySelectorAll("[aria-label]")].map((element) =>
    element.getAttribute("aria-label"),
  );
  expect(labels).toEqual([
    "Editar \u2068Piernas\u2069",
    "Eliminar \u2068Piernas\u2069",
    "Compartir \u2068Piernas\u2069",
    "Ver youtube.com (\u2068Press\u2069)",
  ]);
  labels.forEach(expectSealed);
  const sender = screen.getByText(/^Recibida de/);
  expectSealed(sender.textContent);
  expect(sender.textContent).toBe("Recibida de \u2068Ana\u2069 (\u2068ana@example.com\u2069)");

  fireEvent.click(screen.getByRole("button", { name: "Eliminar \u2068Piernas\u2069" }));
  const dialog = screen.getByRole("alertdialog");
  const title = dialog.querySelector(`#${CSS.escape(dialog.getAttribute("aria-labelledby")!)}`);
  expectSealed(title!.textContent);
  expect(title!.textContent).toBe('¿Eliminar "\u2068Piernas\u2069"?');
});
