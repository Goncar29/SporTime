import { defineConfig } from "vite-plus";

// T32 capacity counts: run only on the emulator (see scripts/capacity/README.md).
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/capacity/**/*.measure.ts"],
    fileParallelism: false,
  },
});
