import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["firestore/**/*.test.ts"],
    // Every test talks to one emulator and clears its data, so files must not overlap.
    fileParallelism: false,
  },
});
