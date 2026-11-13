import type { Page } from "@playwright/test";

/** The tab labels in English and Spanish (Timer is the same in both). */
type TabName = "Timer" | "Saved" | "History" | "Profile" | "Guardados" | "Historial" | "Perfil";

/** Opens a section from the bottom tab bar, named in either language. */
export const openTab = (page: Page, name: TabName) =>
  page
    .getByRole("navigation", { name: /^(Sections|Secciones)$/ })
    .getByRole("button", { name })
    .click();
