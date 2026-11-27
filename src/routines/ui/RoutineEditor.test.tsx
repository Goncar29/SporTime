import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../i18n/ui/I18nProvider";
import type { Routine } from "../domain/routine";
import { RoutineEditor } from "./RoutineEditor";

const LOCAL_LINK_ERROR = "Usa el enlace de un sitio web, no una dirección de red local o IP.";
const INVALID_LINK_ERROR = "Usa un enlace completo que empiece con https://.";

const renderSpanish = (routine: Routine | null) => {
  const onSave = vi.fn();
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["es-AR"]}>
      <RoutineEditor routine={routine} onSave={onSave} onCancel={vi.fn()} />
    </I18nProvider>,
  );
  return { onSave, user: userEvent.setup() };
};

it("refuses to save a link to the local network or an IP address, with an error on the link", async () => {
  const { onSave, user } = renderSpanish(null);
  await user.type(screen.getByRole("textbox", { name: "Nombre de la rutina" }), "Empuje");
  await user.click(screen.getByRole("button", { name: "Agregar etapa" }));
  const link = screen.getByRole("textbox", { name: "Enlace" });
  await user.type(link, "https://192.168.0.1/video");

  expect(link).toHaveAttribute("aria-invalid", "true");
  expect(link).toHaveAccessibleDescription(LOCAL_LINK_ERROR);
  expect(screen.queryByText(INVALID_LINK_ERROR)).not.toBeInTheDocument();
  const save = screen.getByRole("button", { name: "Guardar rutina" });
  expect(save).toBeDisabled();
  await user.click(save);
  expect(onSave).not.toHaveBeenCalled();

  await user.clear(link);
  await user.type(link, "https://www.youtube.com/watch?v=abc");
  expect(link).toHaveAttribute("aria-invalid", "false");
  expect(screen.queryByText(LOCAL_LINK_ERROR)).not.toBeInTheDocument();
  await user.click(save);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0]![0].stages[0].exercises).toEqual([
    { link: "https://www.youtube.com/watch?v=abc" },
  ]);
});

it("shows a stored link to the local network with its error, and saves only once it is fixed", async () => {
  const { onSave, user } = renderSpanish({
    id: "r1",
    name: "Empuje",
    createdAt: 1_000,
    stages: [{ exercises: [{ name: "Remo", link: "https://router/admin" }] }],
  });
  const link = screen.getByRole("textbox", { name: "Enlace" });
  expect(link).toHaveValue("https://router/admin");
  expect(link).toHaveAttribute("aria-invalid", "true");
  expect(link).toHaveAccessibleDescription(LOCAL_LINK_ERROR);
  const save = screen.getByRole("button", { name: "Guardar cambios" });
  expect(save).toBeDisabled();
  await user.click(save);
  expect(onSave).not.toHaveBeenCalled();

  await user.clear(link);
  await user.click(save);
  expect(onSave).toHaveBeenCalledWith({
    name: "Empuje",
    createdAt: 1_000,
    stages: [{ exercises: [{ name: "Remo" }] }],
  });
});

it("still explains a link that is not https as before", async () => {
  const { onSave, user } = renderSpanish(null);
  await user.type(screen.getByRole("textbox", { name: "Nombre de la rutina" }), "Empuje");
  await user.click(screen.getByRole("button", { name: "Agregar etapa" }));
  const link = screen.getByRole("textbox", { name: "Enlace" });
  await user.type(link, "http://youtube.com");
  expect(link).toHaveAccessibleDescription(INVALID_LINK_ERROR);
  expect(screen.getByRole("button", { name: "Guardar rutina" })).toBeDisabled();
  expect(onSave).not.toHaveBeenCalled();
});
