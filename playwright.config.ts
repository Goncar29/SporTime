import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: {
    baseURL: "http://localhost:4173",
    // Uses the installed Chrome, so no browser download is needed.
    channel: "chrome",
  },
  webServer: {
    command: "pnpm exec vp build && pnpm exec vp preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
  },
});
