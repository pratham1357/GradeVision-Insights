import { REALTIME_PATH, type RealtimeSubscribeMessage } from "@gradevision/shared";
import { io, type Socket } from "socket.io-client";

import { tokenStorage } from "./auth-storage";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export interface RealtimeHandlers {
  onSessionChanged?: () => void;
  onAssessmentChanged?: () => void;
  onViolation?: (violationCount: number) => void;
  /**
   * Fires every time a subscription is (re)confirmed - including after an
   * automatic reconnect. Callers use it to re-fetch once so no event is missed
   * during a network gap.
   */
  onReady?: () => void;
  /** `true` once subscribed, `false` on disconnect / auth failure. Drives the polling fallback. */
  onStatus?: (connected: boolean) => void;
}

/** Injectable for tests; defaults to the real socket.io client. */
export type SocketFactory = (url: string, opts: Record<string, unknown>) => Socket;

/**
 * Opens a realtime connection and subscribes. The socket carries only
 * "something changed, re-fetch" signals; the REST endpoints stay authoritative.
 * Returns a disposer. If there is no token the connection is skipped entirely
 * and the caller keeps polling.
 */
export function connectRealtime(
  subscription: RealtimeSubscribeMessage,
  handlers: RealtimeHandlers,
  factory: SocketFactory = (url, opts) => io(url, opts),
): () => void {
  const token = tokenStorage.get();
  if (!token) return () => {};

  const socket = factory(BASE_URL, {
    path: REALTIME_PATH,
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    timeout: 8_000,
  });

  // (Re)subscribe on every (re)connect so a dropped socket self-heals.
  socket.on("connect", () => socket.emit("subscribe", subscription));
  socket.on("subscribe:ok", () => {
    handlers.onStatus?.(true);
    handlers.onReady?.();
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
