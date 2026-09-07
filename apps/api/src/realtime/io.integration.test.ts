/**
 * Realtime ownership gate: a socket may only join rooms the caller owns.
 * Uses the real Socket.IO server + client against an ephemeral port and the
 * `DATABASE_URL` database.
 */
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import { prisma } from "@gradevision/database";
import { REALTIME_PATH } from "@gradevision/shared";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signAccessToken } from "../modules/auth/jwt.js";
import { attachRealtime } from "./io.js";

const ID = {
  instructor: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  studentA: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
  studentB: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
  course: "aaaaaaaa-aaaa-4aaa-8aaa-000000000010",
  section: "aaaaaaaa-aaaa-4aaa-8aaa-000000000020",
  assessment: "aaaaaaaa-aaaa-4aaa-8aaa-000000000030",
  sessionA: "aaaaaaaa-aaaa-4aaa-8aaa-000000000041",
} as const;

let httpServer: HttpServer;
let realtime: ReturnType<typeof attachRealtime>;
let url = "";

async function cleanup() {
  await prisma.examSession.deleteMany({ where: { assessmentId: ID.assessment } });
  await prisma.assessment.deleteMany({ where: { id: ID.assessment } });
  await prisma.enrollment.deleteMany({ where: { sectionId: ID.section } });
  await prisma.section.deleteMany({ where: { id: ID.section } });
  await prisma.course.deleteMany({ where: { id: ID.course } });
  await prisma.user.deleteMany({
    where: { id: { in: [ID.instructor, ID.studentA, ID.studentB] } },
  });
}

beforeAll(async () => {
  await cleanup();
  await prisma.user.createMany({
    data: [
      { id: ID.instructor, email: "aa-i@t.local", name: "I", role: "INSTRUCTOR" },
      { id: ID.studentA, email: "aa-a@t.local", name: "A", role: "STUDENT" },
      { id: ID.studentB, email: "aa-b@t.local", name: "B", role: "STUDENT" },
    ],
  });
  await prisma.course.create({ data: { id: ID.course, code: "AA-RT", name: "RT" } });
  await prisma.section.create({
    data: { id: ID.section, courseId: ID.course, name: "S1", instructorId: ID.instructor },
  });
  await prisma.enrollment.create({
    data: { studentId: ID.studentA, sectionId: ID.section, status: "ACTIVE" },
  });
  await prisma.assessment.create({
    data: {
      id: ID.assessment,
      title: "RT",
      status: "ACTIVE",
      sectionId: ID.section,
      courseId: ID.course,
      createdById: ID.instructor,
    },
  });
  await prisma.examSession.create({
    data: {
      id: ID.sessionA,
      assessmentId: ID.assessment,
      studentId: ID.studentA,
      status: "IN_PROGRESS",
      startedAt: new Date(),
    },
  });

  httpServer = createServer();
  realtime = attachRealtime(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await realtime.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await cleanup();
});

function connect(token: string | undefined): Socket {
  return ioClient(url, {
    path: REALTIME_PATH,
    auth: token ? { token } : {},
    transports: ["websocket"],
    reconnection: false,
  });
}

describe("realtime ownership gate", () => {
  it("rejects a connection with no token", async () => {
    const socket = connect(undefined);
    const reason = await new Promise<string>((resolve) => {
      socket.on("connect_error", (err) => resolve(err.message));
    });
    expect(reason).toBe("unauthorized");
    socket.close();
  });

  it("lets a student subscribe to their own session", async () => {
    const token = await signAccessToken({ sub: ID.studentA, role: "STUDENT" });
    const socket = connect(token);
    const rooms = await new Promise<string[]>((resolve, reject) => {
      socket.on("subscribe:ok", (p: { rooms: string[] }) => resolve(p.rooms));
      socket.on("subscribe:error", (p) => reject(new Error(p.reason)));
      socket.on("connect", () => socket.emit("subscribe", { sessionId: ID.sessionA }));
    });
    expect(rooms).toContain(`session:${ID.sessionA}`);
    socket.close();
  });

  it("refuses a student subscribing to another student's session", async () => {
    const token = await signAccessToken({ sub: ID.studentB, role: "STUDENT" });
    const socket = connect(token);
    const reason = await new Promise<string>((resolve, reject) => {
      socket.on("subscribe:error", (p: { reason: string }) => resolve(p.reason));
      socket.on("subscribe:ok", () => reject(new Error("should not have joined")));
      socket.on("connect", () => socket.emit("subscribe", { sessionId: ID.sessionA }));
    });
    expect(reason).toBe("not_found");
    socket.close();
  });

  it("refuses an instructor subscribing to an assessment they do not own", async () => {
    const token = await signAccessToken({ sub: ID.studentB, role: "INSTRUCTOR" });
    const socket = connect(token);
    const reason = await new Promise<string>((resolve, reject) => {
      socket.on("subscribe:error", (p: { reason: string }) => resolve(p.reason));
      socket.on("subscribe:ok", () => reject(new Error("should not have joined")));
      socket.on("connect", () => socket.emit("subscribe", { assessmentId: ID.assessment }));
    });
    expect(reason).toBe("not_found");
    socket.close();
  });
});
