import { defineConfig } from "@playwright/test";

// Runs inside `firebase emulators:exec`, through `pnpm test:emulator`.
export default defineConfig({
  testDir: "e2e-emulator",
  // Every test shares the emulators and clears their data.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:4175",
    channel: "chrome",
    locale: "en-US",
  },
  webServer: {
    command:
      "pnpm exec vp build --mode emulator --outDir dist-emulator && pnpm exec vp preview --outDir dist-emulator --port 4175 --strictPort",
    url: "http://localhost:4175",
    reuseExistingServer: false,
  },
});
