import { defineConfig } from "vitest/config";

/**
 * Focused unit tests for the client-side resilience helpers (network-error
 * mapping, realtime reconnect/fallback wiring, integrity debounce). They run in
 * a plain Node environment - no DOM, no new dependency - by keeping the logic
 * under test free of React/DOM.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: { NODE_ENV: "test" },
  },
});
