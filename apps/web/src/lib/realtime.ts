import { REALTIME_PATH, type RealtimeSubscribeMessage } from "@gradevision/shared";
import { io, type Socket } from "socket.io-client";

import { tokenStorage } from "./auth-storage";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export interface RealtimeHandlers {
  onSessionChanged?: () => void;
  onAssessmentChanged?: () => void;
  onViolation?: (violationCount: number) => void;
  /** Connection status changes - the caller uses this to fall back to polling. */
  onStatus?: (connected: boolean) => void;
}

/**
 * Opens a realtime connection and subscribes. The socket carries only
 * "something changed, re-fetch" signals; the REST endpoints stay authoritative.
 * Returns a disposer. If there is no token the connection is skipped entirely
 * and the caller keeps polling.
 */
export function connectRealtime(
  subscription: RealtimeSubscribeMessage,
  handlers: RealtimeHandlers,
): () => void {
  const token = tokenStorage.get();
  if (!token) return () => {};

  const socket: Socket = io(BASE_URL, {
    path: REALTIME_PATH,
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  socket.on("connect", () => {
    socket.emit("subscribe", subscription);
    handlers.onStatus?.(true);
  });
  socket.on("subscribe:error", () => handlers.onStatus?.(false));
  socket.on("disconnect", () => handlers.onStatus?.(false));
  socket.on("connect_error", () => handlers.onStatus?.(false));

  socket.on("session:changed", () => handlers.onSessionChanged?.());
  socket.on("assessment:changed", () => handlers.onAssessmentChanged?.());
  socket.on("session:violation", (payload: { violationCount: number }) =>
    handlers.onViolation?.(payload.violationCount),
  );

  return () => {
    socket.removeAllListeners();
    socket.disconnect();
  };
}
