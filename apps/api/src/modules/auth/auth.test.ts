import type { User } from "@gradevision/database";
import express from "express";
import { SignJWT } from "jose";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./auth.repository.js", () => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
}));

import { createApp } from "../../app.js";
import { errorHandler } from "../../middleware/error-handler.js";
import * as repo from "./auth.repository.js";
import { requireRole } from "./auth.middleware.js";
import { signAccessToken } from "./jwt.js";
import { hashPassword } from "./password.js";

const findUserByEmail = vi.mocked(repo.findUserByEmail);
const findUserById = vi.mocked(repo.findUserById);

const app = createApp();
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

const PASSWORD = "student-dev-password";
let passwordHash = "";

function makeUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "student@example.edu",
    name: "Test Student",
    passwordHash,
    role: "STUDENT",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/v1/auth/login", () => {
  it("returns a token and safe user for valid credentials", async () => {
    findUserByEmail.mockResolvedValue(makeUser());

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "student@example.edu", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.data.accessToken).toBe("string");
    expect(res.body.data.user).toEqual({
      id: makeUser().id,
      name: "Test Student",
      email: "student@example.edu",
      role: "STUDENT",
    });
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
    expect(findUserByEmail).toHaveBeenCalledWith("student@example.edu");
  });

  it("normalizes the email before lookup", async () => {
    findUserByEmail.mockResolvedValue(makeUser());
    await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "  Student@Example.edu ", password: PASSWORD });
    expect(findUserByEmail).toHaveBeenCalledWith("student@example.edu");
  });

  it("rejects a wrong password with a generic 401", async () => {
    findUserByEmail.mockResolvedValue(makeUser());

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "student@example.edu", password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.body.error.message).toBe("Invalid email or password");
  });

  it("rejects an unknown email with the same generic 401", async () => {
    findUserByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "ghost@example.edu", password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an inactive user with the same generic 401", async () => {
    findUserByEmail.mockResolvedValue(makeUser({ isActive: false }));

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "student@example.edu", password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a malformed request body with 400", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(findUserByEmail).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/auth/me", () => {
  async function tokenFor(user: User): Promise<string> {
    return signAccessToken({ sub: user.id, role: user.role });
  }

  it("returns the current account for a valid token", async () => {
    const user = makeUser();
    findUserById.mockResolvedValue(user);

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${await tokenFor(user)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      role: "STUDENT",
      isActive: true,
    });
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(findUserById).toHaveBeenCalledWith(user.id);
  });

  it("rejects a missing Authorization header with 401", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a malformed Authorization header with 401", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", "Token abc.def.ghi");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an invalid token with 401", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an expired token with 401", async () => {
    const expired = await new SignJWT({ role: "STUDENT" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(makeUser().id)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(secret);

    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("rejects a token whose user no longer exists with 401", async () => {
    const user = makeUser();
    findUserById.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${await tokenFor(user)}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a token whose user is now inactive with 401", async () => {
    const user = makeUser();
    findUserById.mockResolvedValue(makeUser({ isActive: false }));

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${await tokenFor(user)}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("ACCOUNT_INACTIVE");
  });
});

describe("requireRole", () => {
  function guardedApp() {
    const testApp = express();
    testApp.get("/instructors-only", ...requireRole("INSTRUCTOR", "ADMIN"), (_req, res) => {
      res.json({ data: "ok" });
    });
    testApp.use(errorHandler);
    return testApp;
  }

  async function token(role: User["role"]): Promise<string> {
    return signAccessToken({ sub: "22222222-2222-4222-8222-222222222222", role });
  }

  it("allows a user holding an accepted role", async () => {
    const res = await request(guardedApp())
      .get("/instructors-only")
      .set("Authorization", `Bearer ${await token("INSTRUCTOR")}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBe("ok");
  });

  it("rejects an authenticated user without an accepted role with 403", async () => {
    const res = await request(guardedApp())
      .get("/instructors-only")
      .set("Authorization", `Bearer ${await token("STUDENT")}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(guardedApp()).get("/instructors-only");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
