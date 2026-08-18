import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    pool: "forks",
    restoreMocks: true,
    clearMocks: true,
  },
})
