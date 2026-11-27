import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../i18n/ui/I18nProvider";
import type { Routine } from "../domain/routine";
import { RoutinesScreen } from "./RoutinesScreen";

const own: Routine = { id: "r1", name: "Empuje", createdAt: 2, stages: [] };
const received: Routine = {
  id: "c1",
  name: "Piernas",
  createdAt: 1,
  stages: [],
  receivedFrom: { uid: "ana", name: "Ana", email: "ana@example.com" },
};
const nameless: Routine = {
  ...received,
  id: "c2",
  name: "Brazos",
  receivedFrom: { uid: "bob", name: "", email: "bob@example.com" },
};

const renderIn = (language: "en-US" | "es-AR") =>
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={[language]}>
      <RoutinesScreen
        routines={[own, received, nameless]}
        errors={[]}
        onBack={vi.fn()}
        onNew={vi.fn()}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    </I18nProvider>,
  );

it("marks a received routine in the list with who sent it, isolated (T26, S12)", () => {
  renderIn("es-AR");
  const items = within(screen.getByRole("list", { name: "Rutinas" })).getAllByRole("listitem");
  expect(within(items[0]!).queryByText(/Recibida de/)).not.toBeInTheDocument();
  const sender = within(items[1]!).getByText(
    "Recibida de \u2068Ana\u2069 (\u2068ana@example.com\u2069)",
  );
  expect(sender.tagName).toBe("BDI");
  expect(
    within(items[2]!).getByText("Recibida de \u2068bob@example.com\u2069"),
  ).toBeInTheDocument();
  // Read out with the routine's name when it is focused.
  expect(
    screen.getByRole("button", { name: "Ver \u2068Piernas\u2069" }),
  ).toHaveAccessibleDescription("Recibida de \u2068Ana\u2069 (\u2068ana@example.com\u2069)");
});

it("marks it in English too", () => {
  renderIn("en-US");
  expect(
    screen.getByText("Received from \u2068Ana\u2069 (\u2068ana@example.com\u2069)"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Open \u2068Empuje\u2069" }),
  ).not.toHaveAccessibleDescription();
});

it("isolates every routine's name, own or received, so none can reorder what is around it (L62)", () => {
  renderIn("es-AR");
  const items = within(screen.getByRole("list", { name: "Rutinas" })).getAllByRole("listitem");
  for (const [index, name] of ["Empuje", "Piernas", "Brazos"].entries()) {
    const shown = within(items[index]!).getByText(name);
    expect(shown.tagName, name).toBe("BDI");
    for (const action of ["Ver", "Editar", "Eliminar"]) {
      expect(
        within(items[index]!).getByRole("button", { name: `${action} \u2068${name}\u2069` }),
      ).toBeInTheDocument();
    }
  }
  fireEvent.click(screen.getByRole("button", { name: "Eliminar \u2068Piernas\u2069" }));
  expect(
    screen.getByRole("alertdialog", { name: '¿Eliminar "\u2068Piernas\u2069"?' }),
  ).toBeInTheDocument();
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

it("keeps a name with a stray isolate end from reordering the dialog and labels (L64 B1)", () => {
  const tricky: Routine = {
    id: "c9",
    name: "Piernas\u2069\u202e",
    createdAt: 1,
    stages: [],
    receivedFrom: { uid: "ana", name: "Ana\u2069\u202e", email: "ana@example.com" },
  };
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["es-AR"]}>
      <RoutinesScreen
        routines={[tricky]}
        errors={[]}
        onBack={vi.fn()}
        onNew={vi.fn()}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    </I18nProvider>,
  );
  const item = within(screen.getByRole("list", { name: "Rutinas" })).getByRole("listitem");
  const buttons = within(item).getAllByRole("button");
  for (const button of buttons) expectSealed(button.getAttribute("aria-label"));
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Ver \u2068Piernas\u2069",
    "Editar \u2068Piernas\u2069",
    "Eliminar \u2068Piernas\u2069",
  ]);
  // The sender line, read out with the routine's name.
  const sender = within(item).getByText(/^Recibida de/);
  expectSealed(sender.textContent);
  expect(sender.textContent).toBe("Recibida de \u2068Ana\u2069 (\u2068ana@example.com\u2069)");

  fireEvent.click(buttons[2]!);
  const dialog = screen.getByRole("alertdialog");
  const title = dialog.querySelector(`#${CSS.escape(dialog.getAttribute("aria-labelledby")!)}`);
  expectSealed(title!.textContent);
  expect(title!.textContent).toBe('¿Eliminar "\u2068Piernas\u2069"?');
});
