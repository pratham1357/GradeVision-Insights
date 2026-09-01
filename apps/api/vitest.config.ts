import { defineConfig } from "vitest/config";

/**
 * Auth tests run without a database: the auth repository is mocked, so JWT +
 * Argon2 + middleware + HTTP wiring are exercised end to end with `supertest`.
 * The env values below only need to be structurally valid (nothing connects).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/gradevision_test?schema=public",
      JWT_SECRET: "test-jwt-secret-test-jwt-secret-test-jwt-secret",
      JWT_EXPIRES_IN: "15m",
      API_CORS_ORIGIN: "http://localhost:5173",
    },
  },
});
