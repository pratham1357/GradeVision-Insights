import type { Server as HttpServer } from "node:http";

import { REALTIME_PATH } from "@gradevision/shared";
import { Server, type Socket } from "socket.io";

import { env } from "../env.js";
import { verifyAccessToken } from "../modules/auth/jwt.js";
import type { AuthContext } from "../modules/auth/auth.types.js";
import { prisma } from "../services/database.js";
import { logger } from "../utils/logger.js";
import { RealtimeWatcher, type WatcherEmitter } from "./watcher.js";

export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;
export const assessmentRoom = (assessmentId: string): string => `assessment:${assessmentId}`;

/** Verifies a socket handshake token. Returns `null` for any failure. */
export async function authenticateSocket(token: unknown): Promise<AuthContext | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const claims = await verifyAccessToken(token);
    return { userId: claims.sub, role: claims.role };
  } catch {
    return null;
  }
}

/** A student may subscribe only to their own session. Returns the assessmentId. */
async function studentOwnsSession(sessionId: string, userId: string): Promise<string | null> {
  const row = await prisma.examSession.findFirst({
    where: { id: sessionId, studentId: userId },
    select: { assessmentId: true },
  });
  return row?.assessmentId ?? null;
}

/** An instructor may subscribe only to an assessment they own. */
async function instructorOwnsAssessment(assessmentId: string, userId: string): Promise<boolean> {
  const row = await prisma.assessment.findFirst({
    where: {
      id: assessmentId,
      OR: [{ section: { instructorId: userId } }, { sectionId: null, createdById: userId }],
    },
    select: { id: true },
  });
  return row !== null;
}

interface RealtimeHandle {
  io: Server;
  watcher: RealtimeWatcher;
  close: () => Promise<void>;
}

/**
 * Attaches a Socket.IO server to an existing HTTP server. Auth is by the same
 * access token as the REST API; every room join is ownership-checked.
 */
export function attachRealtime(httpServer: HttpServer): RealtimeHandle {
  const io = new Server(httpServer, {
    path: REALTIME_PATH,
    cors: { origin: env.CORS_ORIGINS.includes("*") ? true : env.CORS_ORIGINS, credentials: true },
    serveClient: false,
    // Small, bursty change-notification traffic only.
    maxHttpBufferSize: 4_096,
  });

  const emitter: WatcherEmitter = {
    toSession: (sessionId, event, payload) => io.to(sessionRoom(sessionId)).emit(event, payload),
    toAssessment: (assessmentId, event, payload) =>
      io.to(assessmentRoom(assessmentId)).emit(event, payload),
  };
  const watcher = new RealtimeWatcher(emitter);

  io.use(async (socket, next) => {
    const auth = await authenticateSocket(
      (socket.handshake.auth as { token?: unknown } | undefined)?.token ??
        socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, ""),
    );
    if (!auth) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.auth = auth;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const auth = socket.data.auth as AuthContext;
    const joined = new Set<string>();

    socket.on("subscribe", async (message: unknown) => {
      const { sessionId, assessmentId } = (message ?? {}) as {
        sessionId?: string;
        assessmentId?: string;
      };
      const rooms: string[] = [];
      try {
        if (typeof sessionId === "string" && auth.role === "STUDENT") {
          const assessment = await studentOwnsSession(sessionId, auth.userId);
          if (!assessment) {
            socket.emit("subscribe:error", { reason: "not_found" });
            return;
          }
          await socket.join(sessionRoom(sessionId));
          watcher.addSession(sessionId);
          joined.add(sessionRoom(sessionId));
          rooms.push(sessionRoom(sessionId));
        }
        if (typeof assessmentId === "string" && auth.role === "INSTRUCTOR") {
          if (!(await instructorOwnsAssessment(assessmentId, auth.userId))) {
            socket.emit("subscribe:error", { reason: "not_found" });
            return;
          }
          await socket.join(assessmentRoom(assessmentId));
          watcher.addAssessment(assessmentId);
          joined.add(assessmentRoom(assessmentId));
          rooms.push(assessmentRoom(assessmentId));
        }
        if (rooms.length === 0) {
          socket.emit("subscribe:error", { reason: "invalid" });
          return;
        }
        socket.emit("subscribe:ok", { rooms });
      } catch (error) {
        logger.warn("realtime subscribe failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        socket.emit("subscribe:error", { reason: "error" });
      }
    });

    socket.on("disconnect", () => {
      for (const room of joined) {
        if (room.startsWith("session:")) watcher.removeSession(room.slice("session:".length));
        if (room.startsWith("assessment:")) {
          watcher.removeAssessment(room.slice("assessment:".length));
        }
      }
    });
  });

  logger.info("realtime (socket.io) attached", { path: REALTIME_PATH });

  return {
    io,
    watcher,
    close: async () => {
      watcher.stop();
      await io.close();
    },
  };
}
