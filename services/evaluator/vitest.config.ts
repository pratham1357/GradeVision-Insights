import { defineConfig } from "vitest/config";

/**
 * The `evaluate` suite is a real DB integration test with a MOCK execution
 * provider (no Judge0 needed). It uses the same PostgreSQL as the API tests.
 */
const DEV_DATABASE_URL =
  "postgresql://gradevision:gradevision_dev_pw@localhost:5432/gradevision?schema=public";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? DEV_DATABASE_URL,
    },
  },
});
