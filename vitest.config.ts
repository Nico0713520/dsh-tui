import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    pool: "forks",
    fileParallelism: process.platform !== "win32",
    restoreMocks: true,
    clearMocks: true,
  },
})
