import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "../..",
  esbuild: { jsx: "automatic" },
  test: {
    include: ["apps/web/tests/**/*.test.{ts,tsx}"],
    environment: "edge-runtime",
    clearMocks: true,
    restoreMocks: true
  }
});
