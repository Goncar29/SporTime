import type { Page } from "@playwright/test";

/** Opens a section from the bottom tab bar, named in either language. */
export const openTab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: /^(Sections|Secciones)$/ })
    .getByRole("button", { name })
    .click();
