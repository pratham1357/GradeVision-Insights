/**
 * Admin account management against the dedicated test database. Fixtures use
 * ids under `adadadad-…`; users created through the API use `@admin-test.local`
 * emails. Both are removed before and after. The seeded admin (if present) is
 * only ever toggled inside a test and always restored.
 */
import { prisma } from "@gradevision/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { LastAdminError, updateUserWithAudit } from "./admin/admin.repository.js";
import { issueSessionToken } from "./auth/sessions.js";

const app = createApp();
const ID = {
  adminA: "adadadad-adad-4dad-8dad-000000000001",
  adminB: "adadadad-adad-4dad-8dad-000000000002",
  instructor: "adadadad-adad-4dad-8dad-000000000003",
  student: "adadadad-adad-4dad-8dad-000000000004",
  course: "adadadad-adad-4dad-8dad-000000000010",
  section: "adadadad-adad-4dad-8dad-000000000020",
} as const;
const FIXTURES = [ID.adminA, ID.adminB, ID.instructor, ID.student];
const PASSWORD = "a-long-enough-passphrase";

async function cleanup(): Promise<void> {
  const created = await prisma.user.findMany({
    where: { email: { endsWith: "@admin-test.local" } },
    select: { id: true },
  });
  const ids = [...FIXTURES, ...created.map((u) => u.id)];
  await prisma.auditEvent.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] },
  });
  await prisma.enrollment.deleteMany({ where: { sectionId: ID.section } });
  await prisma.section.deleteMany({ where: { id: ID.section } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

const bearer = async (id: string, role: "ADMIN" | "INSTRUCTOR" | "STUDENT") =>
  `Bearer ${await issueSessionToken(id, role)}`;

let adminA = "";
let adminB = "";

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.adminA, email: "ad-a@t.local", name: "Admin A", role: "ADMIN" },
      { id: ID.adminB, email: "ad-b@t.local", name: "Admin B", role: "ADMIN" },
      { id: ID.instructor, email: "ad-i@t.local", name: "Instr", role: "INSTRUCTOR" },
      { id: ID.student, email: "ad-s@t.local", name: "Stud", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "AD-101", name: "Admin Course" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "AD S1", instructorId: ID.instructor },
  });
  adminA = await bearer(ID.adminA, "ADMIN");
  adminB = await bearer(ID.adminB, "ADMIN");
});
afterAll(cleanup);

const createUser = (auth: string, body: object) =>
  request(app).post("/api/v1/admin/users").set("Authorization", auth).send(body);

describe("admin authorization", () => {
  it("is ADMIN-only: students and instructors are refused, anonymous needs auth", async () => {
    const student = await bearer(ID.student, "STUDENT");
    const instructor = await bearer(ID.instructor, "INSTRUCTOR");
    for (const path of ["/api/v1/admin/users", "/api/v1/admin/sections", "/api/v1/admin/audit"]) {
      expect((await request(app).get(path)).status, path).toBe(401);
      expect((await request(app).get(path).set("Authorization", student)).status, path).toBe(403);
      expect((await request(app).get(path).set("Authorization", instructor)).status, path).toBe(
        403,
      );
    }
    // No privilege escalation through the admin API without the ADMIN role.
    const escalate = await request(app)
      .patch(`/api/v1/admin/users/${ID.instructor}`)
      .set("Authorization", instructor)
      .send({ role: "ADMIN" });
    expect(escalate.status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ID.instructor } })).role).toBe(
      "INSTRUCTOR",
    );
  });
});

describe("user management", () => {
  it("creates an enrolled student who can sign in; never returns or audits the password", async () => {
    const res = await createUser(adminA, {
      email: "  New.Student@Admin-Test.local ",
      name: "New Student",
      role: "STUDENT",
      password: PASSWORD,
      sectionId: ID.section,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: "new.student@admin-test.local",
      role: "STUDENT",
      isActive: true,
      sections: [{ id: ID.section, courseCode: "AD-101" }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|a-long-enough/);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "new.student@admin-test.local", password: PASSWORD, mode: "token" });
    expect(login.status).toBe(200);

    const audit = await request(app).get("/api/v1/admin/audit").set("Authorization", adminA);
    const entry = (audit.body.data as { action: string; entityId: string }[]).find(
      (e) => e.action === "user.created" && e.entityId === res.body.data.id,
    );
    expect(entry).toBeDefined();
    expect(audit.text).not.toContain(PASSWORD);
  });

  it("validates input and refuses duplicates", async () => {
    const base = {
      email: "dupe@admin-test.local",
      name: "Dupe",
      role: "STUDENT",
      password: PASSWORD,
    };
    expect((await createUser(adminA, base)).status).toBe(201);
    expect((await createUser(adminA, base)).status).toBe(409);
    expect((await createUser(adminA, { ...base, email: "DUPE@admin-test.local" })).status).toBe(
      409,
    );
    for (const bad of [
      { ...base, email: "x1@admin-test.local", password: "short" },
      { ...base, email: "not-an-email" },
      { ...base, email: "x2@admin-test.local", role: "ROOT" },
      { ...base, email: "x3@admin-test.local", name: "" },
    ]) {
      expect((await createUser(adminA, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    // Only students are enrolled; unknown sections are 404.
    expect(
      (
        await createUser(adminA, {
          ...base,
          email: "x4@admin-test.local",
          role: "INSTRUCTOR",
          sectionId: ID.section,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await createUser(adminA, {
          ...base,
          email: "x5@admin-test.local",
          sectionId: "adadadad-adad-4dad-8dad-0000000000ff",
        })
      ).status,
    ).toBe(404);
  });

  it("lists and searches users", async () => {
    const res = await request(app)
      .get("/api/v1/admin/users?search=admin-test.local&role=STUDENT")
      .set("Authorization", adminA);
    expect(res.status).toBe(200);
    const emails = (res.body.data as { email: string; role: string }[]).map((u) => u.email);
    expect(emails).toContain("new.student@admin-test.local");
    expect((res.body.data as { role: string }[]).every((u) => u.role === "STUDENT")).toBe(true);
    expect(res.text).not.toContain("passwordHash");
    expect(
      (await request(app).get("/api/v1/admin/users?role=ROOT").set("Authorization", adminA)).status,
    ).toBe(400);
  });

  it("a role change ends the user's sessions and applies immediately", async () => {
    const studentSession = await bearer(ID.student, "STUDENT");
    const res = await request(app)
      .patch(`/api/v1/admin/users/${ID.student}`)
      .set("Authorization", adminA)
      .send({ role: "INSTRUCTOR" });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("INSTRUCTOR");
    expect(
      (await request(app).get("/api/v1/auth/me").set("Authorization", studentSession)).status,
    ).toBe(401);
    await request(app)
      .patch(`/api/v1/admin/users/${ID.student}`)
      .set("Authorization", adminA)
      .send({ role: "STUDENT" });
  });

  it("deactivation ends sessions and blocks sign-in; reactivation restores sign-in only", async () => {
    await prisma.user.update({
      where: { id: ID.student },
      data: {
        passwordHash: (
          await prisma.user.findFirstOrThrow({ where: { email: "new.student@admin-test.local" } })
        ).passwordHash,
      },
    });
    const session = await bearer(ID.student, "STUDENT");
    const off = await request(app)
      .patch(`/api/v1/admin/users/${ID.student}`)
      .set("Authorization", adminA)
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ isActive: false, activeSessions: 0 });
    expect((await request(app).get("/api/v1/auth/me").set("Authorization", session)).status).toBe(
      401,
    );
    const login = () =>
      request(app)
        .post("/api/v1/auth/login")
        .send({ email: "ad-s@t.local", password: PASSWORD, mode: "token" });
    expect((await login()).status).toBe(401);

    await request(app)
      .patch(`/api/v1/admin/users/${ID.student}`)
      .set("Authorization", adminA)
      .send({ isActive: true });
    // The old session stays dead; a fresh sign-in works.
    expect((await request(app).get("/api/v1/auth/me").set("Authorization", session)).status).toBe(
      401,
    );
    expect((await login()).status).toBe(200);
  });

  it("setting a password ends existing sessions", async () => {
    const session = await bearer(ID.student, "STUDENT");
    const res = await request(app)
      .post(`/api/v1/admin/users/${ID.student}/password`)
      .set("Authorization", adminA)
      .send({ password: "another-long-passphrase" });
    expect(res.status).toBe(200);
    expect((await request(app).get("/api/v1/auth/me").set("Authorization", session)).status).toBe(
      401,
    );
    expect(
      (
        await request(app)
          .post("/api/v1/auth/login")
          .send({ email: "ad-s@t.local", password: "another-long-passphrase", mode: "token" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/v1/admin/users/${ID.student}/password`)
          .set("Authorization", adminA)
          .send({ password: "short" })
      ).status,
    ).toBe(400);
  });

  it("returns 404 for unknown users and 400 for malformed ids", async () => {
    expect(
      (
        await request(app)
          .patch("/api/v1/admin/users/adadadad-adad-4dad-8dad-0000000000ee")
          .set("Authorization", adminA)
          .send({ name: "x" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch("/api/v1/admin/users/nope")
          .set("Authorization", adminA)
          .send({ name: "x" })
      ).status,
    ).toBe(400);
  });
});

describe("administrator safeguards", () => {
  it("an admin cannot demote or deactivate themselves", async () => {
    for (const body of [{ role: "STUDENT" }, { isActive: false }]) {
      const res = await request(app)
        .patch(`/api/v1/admin/users/${ID.adminA}`)
        .set("Authorization", adminA)
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SELF_CHANGE");
    }
  });

  it("the last active administrator cannot be demoted or deactivated, even concurrently", async () => {
    // Only the two fixture admins may be active for this test (others restored afterwards).
    const others = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, id: { notIn: [ID.adminA, ID.adminB] } },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { isActive: false },
    });
    try {
      // Two admins demote each other at the same moment: at most one can win.
      const [ab, ba] = await Promise.all([
        request(app)
          .patch(`/api/v1/admin/users/${ID.adminB}`)
          .set("Authorization", adminA)
          .send({ role: "INSTRUCTOR" }),
        request(app)
          .patch(`/api/v1/admin/users/${ID.adminA}`)
          .set("Authorization", adminB)
          .send({ role: "INSTRUCTOR" }),
      ]);
      const statuses = [ab.status, ba.status].sort();
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);
      expect(
        await prisma.user.count({
          where: { id: { in: [ID.adminA, ID.adminB] }, role: "ADMIN", isActive: true },
        }),
      ).toBeGreaterThanOrEqual(1);

      // Whoever is left is now the last admin and cannot be removed by the other path either.
      const remaining = await prisma.user.findFirstOrThrow({
        where: { id: { in: [ID.adminA, ID.adminB] }, role: "ADMIN", isActive: true },
      });
      const actor = await bearer(remaining.id, "ADMIN");
      const helper = await createUser(actor, {
        email: "helper-admin@admin-test.local",
        name: "Helper",
        role: "ADMIN",
        password: PASSWORD,
      });
      expect(helper.status).toBe(201);
      const helperSession = await bearer(helper.body.data.id as string, "ADMIN");
      // Deactivate the helper, then the remaining admin is the last one again.
      expect(
        (
          await request(app)
            .patch(`/api/v1/admin/users/${helper.body.data.id}`)
            .set("Authorization", actor)
            .send({ isActive: false })
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get("/api/v1/admin/users").set("Authorization", helperSession)).status,
      ).toBe(401);
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { isActive: true },
      });
      await prisma.user.updateMany({
        where: { id: { in: [ID.adminA, ID.adminB] } },
        data: { role: "ADMIN", isActive: true },
      });
      adminA = await bearer(ID.adminA, "ADMIN");
      adminB = await bearer(ID.adminB, "ADMIN");
    }
  });

  it("the transactional guard itself refuses to remove the only active admin", async () => {
    const others = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, id: { not: ID.adminA } },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { isActive: false },
    });
    try {
      await expect(
        updateUserWithAudit(
          ID.adminA,
          { role: "STUDENT" },
          { actorId: ID.adminA, action: "test", summary: "test", metadata: {} },
          true,
        ),
      ).rejects.toBeInstanceOf(LastAdminError);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ID.adminA } })).role).toBe(
        "ADMIN",
      );
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: others.map((o) => o.id) } },
        data: { isActive: true },
      });
    }
  });
});
