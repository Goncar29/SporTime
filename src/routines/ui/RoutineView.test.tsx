import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
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
  expect(screen.getByRole("button", { name: "Editar Empuje" })).toBeInTheDocument();
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
  const link = within(table).getByRole("link", { name: "Ver youtube.com (Press banca)" });
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
  expect(screen.queryByRole("button", { name: "Compartir Piernas" })).not.toBeInTheDocument();
  rerender(view(onShare));
  const button = screen.getByRole("button", { name: "Compartir Piernas" });
  expect(button.textContent).toBe("Compartir");
  button.click();
  expect(onShare).toHaveBeenCalledWith(routine);
});
