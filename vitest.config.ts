import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "apps/*/tests/**/*.test.ts", "packages/*/tests/**/*.test.ts", "services/*/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
});