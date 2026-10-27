import path from "node:path";
import { defineConfig } from "vitest/config";

/*
 * Unit tests live in `tests/`, mirroring the module they cover. Server modules import `server-only`
 * (which throws outside Next's server bundle) and `@/…` paths, so both are aliased here. Component
 * tests opt into jsdom with a `@vitest-environment jsdom` docblock.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: true,
    clearMocks: true,
  },
});
