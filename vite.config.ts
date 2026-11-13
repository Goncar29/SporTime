import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: lazyPlugins(() => [
    react(),
    VitePWA({
      // The app decides when a new version takes over, so it never reloads during a workout.
      registerType: "prompt",
      workbox: {
        // The first worker serves the open page at once, so it works offline from the first visit.
        // Later versions still wait for the app to apply them.
        clientsClaim: true,
        // Fonts are not precached by default, and the design relies on them offline.
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        // Firebase Hosting serves its sign-in handler here; the app shell must not answer it.
        navigateFallbackDenylist: [/^\/__\//],
      },
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Sportime",
        short_name: "Sportime",
        description: "Workout timer: stopwatch, For Time, AMRAP, EMOM, Tabata and intervals.",
        lang: "en",
        display: "standalone",
        orientation: "any",
        background_color: "#0b0d10",
        theme_color: "#0b0d10",
        start_url: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ]),
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
