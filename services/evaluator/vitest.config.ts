import { defineConfig } from "vitest/config";

/** The `evaluate` suite is a real DB integration test with a MOCK execution provider. */
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
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL,
    },
  },
});
