import { defineConfig } from "vitest/config";

/**
 * Test env. `auth` / `jwt` / `password` suites mock the repository and never
 * connect. The `instructor` suite is a real integration test and needs the
 * PostgreSQL database in `DATABASE_URL` (the seeded dev DB locally; the CI
 * service DB in CI, where the job sets `DATABASE_URL`).
 */
const DEV_DATABASE_URL =
  "postgresql://gradevision:gradevision_dev_pw@localhost:5432/gradevision?schema=public";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share one database; run test files serially.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? DEV_DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret-test-jwt-secret-test-jwt-secret",
      JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "15m",
      API_CORS_ORIGIN: "http://localhost:5173",
    },
  },
});
