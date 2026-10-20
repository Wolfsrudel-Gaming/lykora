import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Alle Tests teilen sich eine Testdatenbank.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
