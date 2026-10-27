import type { Server as HttpServer } from "node:http";

import { REALTIME_PATH } from "@gradevision/shared";
import { Server, type Socket } from "socket.io";

import { env } from "../env.js";
import type { AuthContext } from "../modules/auth/auth.types.js";
import {
  recheckSession,
  resolveSession,
  SESSION_COOKIE,
  sessionEvents,
  type SessionsRevokedEvent,
} from "../modules/auth/sessions.js";
import { prisma } from "../services/database.js";
import { logger } from "../utils/logger.js";
import { RealtimeWatcher, type WatcherEmitter } from "./watcher.js";

export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;
export const assessmentRoom = (assessmentId: string): string => `assessment:${assessmentId}`;

/** Verifies a socket handshake token. Returns `null` for any failure. */
function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The same server-side session as the REST API: the browser's HttpOnly cookie
 * (sent with the handshake), or an opaque session token for non-browser clients.
 */
export async function authenticateSocket(
  token: unknown,
  cookieHeader?: string,
): Promise<AuthContext | null> {
  const presented =
    typeof token === "string" && token.length > 0
      ? token
      : cookieValue(cookieHeader, SESSION_COOKIE);
  if (!presented) return null;
  try {
    const session = await resolveSession(presented);
    return session
      ? {
          userId: session.userId,
          role: session.role,
          sessionId: session.sessionId,
          via: presented === token ? "bearer" : "cookie",
        }
      : null;
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
      socket.handshake.headers.cookie,
    );
    if (!auth) {
      next(new Error("unauthorized"));
      return;
    }
    socket.data.auth = auth;
    next();
  });

  // A revoked session (logout, deactivation, role change) loses its live sockets at once.
  const onRevoked = ({ sessionIds }: SessionsRevokedEvent) => {
    const ended = new Set(sessionIds);
    for (const socket of io.sockets.sockets.values()) {
      const auth = socket.data.auth as AuthContext | undefined;
      if (auth && ended.has(auth.sessionId)) socket.disconnect(true);
    }
  };
  sessionEvents.on("revoked", onRevoked);

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
        // Every event is re-authorized against the CURRENT session, user status
        // and role - not just the handshake.
        const current = await recheckSession(auth.sessionId);
        if (!current) {
          socket.emit("subscribe:error", { reason: "unauthorized" });
          socket.disconnect(true);
          return;
        }
        auth.role = current.role;
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
      sessionEvents.off("revoked", onRevoked);
      watcher.stop();
      await io.close();
    },
  };
}
