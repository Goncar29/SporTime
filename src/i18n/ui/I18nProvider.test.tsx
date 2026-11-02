import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider, useI18n } from "./I18nProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";

function Sample() {
  const { t } = useI18n();
  return <p>{t.start}</p>;
}

function setup(stored: string | null, browserLanguages: string[]) {
  const store = { get: () => stored, set: vi.fn() };
  render(
    <I18nProvider store={store} browserLanguages={browserLanguages}>
      <LanguageSwitcher />
      <Sample />
    </I18nProvider>,
  );
  return store;
}

describe("I18nProvider", () => {
  it("starts in the browser language and marks the document for screen readers", () => {
    setup(null, ["es-AR"]);
    expect(screen.getByText("Iniciar")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
  });

  it("starts in the stored language over the browser one", () => {
    setup("en", ["es-AR"]);
    expect(screen.getByText("Start")).toBeInTheDocument();
  });

  it("switching changes the text, the document language and what is stored", () => {
    const store = setup(null, ["en"]);
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    expect(screen.getByText("Iniciar")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
    expect(store.set).toHaveBeenCalledWith("es");
  });

  it("shows which language is active, each named in its own language", () => {
    setup(null, ["en"]);
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("does not store a language until the user chooses one", () => {
    const store = setup(null, ["es"]);
    expect(store.set).not.toHaveBeenCalled();
  });
});
