import { defineConfig } from "vitest/config";

/**
 * Integration suites create and delete fixture rows, so they must never run
 * against the development/demo database. Default to the dedicated test
 * database and refuse anything whose name does not say "test".
 */
const TEST_DATABASE_URL =
  "postgresql://gradevision:gradevision_dev_pw@localhost:5432/gradevision_test?schema=public";
const DATABASE_URL = process.env.DATABASE_URL ?? TEST_DATABASE_URL;
const databaseName = URL.canParse(DATABASE_URL)
  ? decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1))
  : "";
if (!/test/i.test(databaseName)) {
  throw new Error(
    `Refusing to run tests against database '${databaseName}': use a dedicated test database (e.g. gradevision_test).`,
  );
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share one database; run test files serially.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET ?? "test-jwt-secret-test-jwt-secret-test-jwt-secret",
      API_CORS_ORIGIN: "http://localhost:5173",
    },
  },
});
