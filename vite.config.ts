import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, lazyPlugins } from "vite-plus";

interface BundledFile {
  fileName: string;
}

/** Fetches the fonts with the page, instead of only once the CSS that names them has loaded. */
const preloadFonts = {
  name: "sportime:preload-fonts",
  apply: "build" as const,
  transformIndexHtml: {
    order: "post" as const,
    handler(_html: string, { bundle }: { bundle?: Record<string, BundledFile> }) {
      return Object.values(bundle ?? {})
        .map(({ fileName }) => fileName)
        .filter((fileName) => /barlow-condensed-latin-.+\.woff2$/.test(fileName))
        .map((fileName) => ({
          tag: "link",
          attrs: {
            rel: "preload",
            as: "font",
            type: "font/woff2",
            href: `/${fileName}`,
            crossorigin: "",
          },
          injectTo: "head" as const,
        }));
    },
  },
};

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
    preloadFonts,
    VitePWA({
      // The app decides when a new version takes over, so it never reloads during a workout.
      registerType: "prompt",
      workbox: {
        // The first worker serves the open page at once, so it works offline from the first visit.
        // Later versions still wait for the app to apply them.
        clientsClaim: true,
        // Fonts are not precached by default, and the design relies on them offline.
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        // Only link previews on other sites use it, so it is not stored on the device.
        globIgnores: ["og-image.png"],
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
