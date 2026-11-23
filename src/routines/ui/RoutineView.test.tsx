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
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual(["Ejercicio", "Repeticiones", "Pausa", "Peso"]);
  expect(
    within(table)
      .getAllByRole("cell")
      .map((cell) => cell.textContent),
  ).toEqual(["Press banca", "8 - 10", "90''", "62,5 kg"]);
  expect(screen.getByRole("button", { name: "Editar Empuje" })).toBeInTheDocument();
});
