/**
 * Authentication and session lifecycle against the real database in
 * `DATABASE_URL` (a dedicated test database). Fixture users live under the
 * `11111111-…` id range and are removed before and after the run.
 */
import { prisma } from "@gradevision/database";
import express from "express";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { errorHandler } from "../../middleware/error-handler.js";
import { requireRole } from "./auth.middleware.js";
import { MAX_FAILURES, resetLoginThrottle } from "./login-throttle.js";
import { hashPassword } from "./password.js";
import { hashToken, issueSessionToken, SESSION_COOKIE } from "./sessions.js";

const app = createApp();
const ORIGIN = "http://localhost:5173";
const PASSWORD = "student-dev-password";
const ID = {
  student: "11111111-1111-4111-8111-111111111111",
  instructor: "11111111-1111-4111-8111-111111111112",
  other: "11111111-1111-4111-8111-111111111113",
} as const;
const EMAIL = "auth-student@t.local";

async function cleanup(): Promise<void> {
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ID) } } });
}

beforeAll(async () => {
  await cleanup();
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.user.createMany({
    data: [
      { id: ID.student, email: EMAIL, name: "Auth Student", role: "STUDENT", passwordHash },
      {
        id: ID.instructor,
        email: "auth-instr@t.local",
        name: "Auth Instr",
        role: "INSTRUCTOR",
        passwordHash,
      },
      {
        id: ID.other,
        email: "auth-other@t.local",
        name: "Auth Other",
        role: "STUDENT",
        passwordHash,
      },
    ],
  });
});
afterAll(cleanup);
afterEach(async () => {
  resetLoginThrottle();
  await prisma.user.updateMany({
    where: { id: { in: Object.values(ID) } },
    data: { isActive: true },
  });
  await prisma.user.update({ where: { id: ID.student }, data: { role: "STUDENT" } });
});

/** Signs in through the browser path; returns the cookie pair and the CSRF token. */
async function browserLogin(email = EMAIL) {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .set("Origin", ORIGIN)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const sessionCookie = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  return {
    res,
    setCookie: sessionCookie,
    cookie: sessionCookie.split(";")[0]!,
    csrf: res.body.data.csrfToken as string,
  };
}

describe("POST /api/v1/auth/login", () => {
  it("opens a server-side session in an HttpOnly cookie and returns no token to page scripts", async () => {
    const { res, setCookie } = await browserLogin();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(res.body.data).not.toHaveProperty("accessToken");
    expect(typeof res.body.data.csrfToken).toBe("string");
    expect(res.body.data.user).toEqual({
      id: ID.student,
      name: "Auth Student",
      email: EMAIL,
      role: "STUDENT",
    });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    // Only a hash of the identifier is stored.
    const raw = setCookie.split(";")[0]!.split("=")[1]!;
    expect(await prisma.authSession.count({ where: { tokenHash: raw } })).toBe(0);
    expect(await prisma.authSession.count({ where: { tokenHash: hashToken(raw) } })).toBe(1);
  });

  it("token mode (non-browser clients) returns the opaque token instead of a cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: EMAIL, password: PASSWORD, mode: "token" });
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it("normalizes the email and fails generically for wrong password, unknown email and inactive users", async () => {
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "  AUTH-Student@T.local ", password: PASSWORD })
      ).status,
    ).toBe(200);
    for (const body of [
      { email: EMAIL, password: "not-the-password" },
      { email: "ghost@t.local", password: PASSWORD },
    ]) {
      const res = await request(app).post("/api/v1/auth/login").send(body);
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    }
    await prisma.user.update({ where: { id: ID.student }, data: { isActive: false } });
    const inactive = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: EMAIL, password: PASSWORD });
    expect(inactive.status).toBe(401);
    expect(inactive.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects malformed bodies and sign-in from a foreign origin (login CSRF)", async () => {
    expect(
      (await request(app).post("/api/v1/auth/login").send({ email: "not-an-email" })).status,
    ).toBe(400);
    const foreign = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: EMAIL, password: PASSWORD });
    expect(foreign.status).toBe(403);
    expect(foreign.headers["set-cookie"]).toBeUndefined();
  });

  it("rotates: signing in again ends the session the browser carried", async () => {
    const first = await browserLogin();
    const second = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", ORIGIN)
      .set("Cookie", first.cookie)
      .send({ email: EMAIL, password: PASSWORD });
    expect(second.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", first.cookie)).status).toBe(
      401,
    );
  });
});

describe("cookie sessions", () => {
  it("GET /auth/session returns the current user and the session's CSRF token", async () => {
    const { cookie, csrf } = await browserLogin();
    const res = await request(app).get("/api/v1/auth/session").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: ID.student, role: "STUDENT", isActive: true });
    expect(res.body.data.csrfToken).toBe(csrf);
  });

  it("requires origin + CSRF token on state-changing cookie requests", async () => {
    const { cookie, csrf } = await browserLogin();
    const logout = () => request(app).post("/api/v1/auth/logout").set("Cookie", cookie);

    expect((await logout().set("Origin", ORIGIN)).status).toBe(403); // no token
    expect((await logout().set("Origin", ORIGIN).set("X-CSRF-Token", "x".repeat(43))).status).toBe(
      403,
    );
    expect(
      (await logout().set("Origin", "https://evil.example").set("X-CSRF-Token", csrf)).status,
    ).toBe(403);
    expect((await logout().set("X-CSRF-Token", csrf)).status).toBe(403); // no Origin/Referer
    // Another session's token does not work for this one.
    const other = await browserLogin("auth-other@t.local");
    expect((await logout().set("Origin", ORIGIN).set("X-CSRF-Token", other.csrf)).status).toBe(403);

    // Still signed in after all the refused attempts.
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(200);
  });

  it("logout ends the session server-side and clears the cookie", async () => {
    const { cookie, csrf } = await browserLogin();
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(204);
    expect(([] as string[]).concat(res.headers["set-cookie"] ?? []).join(";")).toMatch(
      new RegExp(`${SESSION_COOKIE}=;`),
    );
    expect((await request(app).get("/api/v1/auth/me").set("Cookie", cookie)).status).toBe(401);
  });

  it("a bearer-presented session needs no CSRF token (not sent automatically by browsers)", async () => {
    const token = await issueSessionToken(ID.student, "STUDENT");
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(
      (await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`)).status,
    ).toBe(401);
  });
});

describe("session validity is re-checked on every request", () => {
  it("a role change applies immediately (no stale role claim)", async () => {
    const token = await issueSessionToken(ID.student, "STUDENT");
    const auth = `Bearer ${token}`;
    expect(
      (await request(app).get("/api/v1/student/assessments").set("Authorization", auth)).status,
    ).toBe(200);
    await prisma.user.update({ where: { id: ID.student }, data: { role: "INSTRUCTOR" } });
    expect(
      (await request(app).get("/api/v1/student/assessments").set("Authorization", auth)).status,
    ).toBe(403);
    expect((await request(app).get("/api/v1/questions").set("Authorization", auth)).status).toBe(
      200,
    );
  });

  it("a deactivated user is rejected at once", async () => {
    const auth = `Bearer ${await issueSessionToken(ID.student, "STUDENT")}`;
    await prisma.user.update({ where: { id: ID.student }, data: { isActive: false } });
    expect((await request(app).get("/api/v1/auth/me").set("Authorization", auth)).status).toBe(401);
  });

  it("enforces idle timeout, absolute expiry and revocation", async () => {
    for (const data of [
      { lastSeenAt: new Date(Date.now() - 24 * 3_600_000) },
      { expiresAt: new Date(Date.now() - 1_000) },
      { revokedAt: new Date(), revokedReason: "test" },
    ]) {
      const token = await issueSessionToken(ID.student, "STUDENT");
      await prisma.authSession.update({ where: { tokenHash: hashToken(token) }, data });
      const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
      expect(res.status, JSON.stringify(data)).toBe(401);
    }
  });

  it("rejects unknown, malformed and JWT-shaped tokens", async () => {
    const jwt = await new SignJWT({ role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ID.instructor)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    for (const header of [
      "Bearer not.a.token",
      `Bearer ${jwt}`,
      "Token abc",
      "Bearer " + "a".repeat(43),
    ]) {
      const res = await request(app).get("/api/v1/auth/me").set("Authorization", header);
      expect(res.status, header.slice(0, 20)).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    }
    const cookieRes = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `${SESSION_COOKIE}=forged-value-${"b".repeat(30)}`);
    expect(cookieRes.status).toBe(401);
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

  it("allows an accepted role, forbids others, and requires authentication", async () => {
    const instructor = await issueSessionToken(ID.instructor, "INSTRUCTOR");
    const student = await issueSessionToken(ID.student, "STUDENT");
    expect(
      (
        await request(guardedApp())
          .get("/instructors-only")
          .set("Authorization", `Bearer ${instructor}`)
      ).status,
    ).toBe(200);
    const forbidden = await request(guardedApp())
      .get("/instructors-only")
      .set("Authorization", `Bearer ${student}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN");
    expect((await request(guardedApp()).get("/instructors-only")).status).toBe(401);
  });
});

describe("login throttling", () => {
  const attempt = (password: string, email = EMAIL) =>
    request(app).post("/api/v1/auth/login").send({ email, password });

  it("returns 429 after repeated failures, even for the right password, and only for that account", async () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      expect((await attempt("wrong-password")).status).toBe(401);
    }
    const blocked = await attempt(PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
    expect((await attempt(PASSWORD, "auth-other@t.local")).status).toBe(200);
  });

  it("a successful login clears earlier failures", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) await attempt("wrong-password");
    expect((await attempt(PASSWORD)).status).toBe(200);
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) {
      expect((await attempt("wrong-password")).status).toBe(401);
    }
  });
});

describe("security headers", () => {
  it("sets baseline headers on every API response", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
