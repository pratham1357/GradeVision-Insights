/**
 * Realtime (Socket.IO) contract.
 *
 * The socket carries only lightweight "something changed, re-fetch" signals -
 * the REST endpoints remain the single source of truth for all data. If the
 * socket is unavailable the clients fall back to interval polling.
 */

/** Path the Socket.IO server is mounted on (same origin as the REST API). */
export const REALTIME_PATH = "/realtime";

/** Client -> server: subscribe to updates. Ownership is re-checked server-side. */
export interface RealtimeSubscribeMessage {
  /** A student's own exam session id. */
  sessionId?: string;
  /** An assessment the caller owns (instructor). */
  assessmentId?: string;
}

/** Server -> client events. Payloads are intentionally minimal. */
export interface RealtimeServerEvents {
  /** An evaluation run or submission in this session changed. */
  "session:changed": (payload: { sessionId: string }) => void;
  /** Results/violations for this assessment changed. */
  "assessment:changed": (payload: { assessmentId: string }) => void;
  /** A new integrity violation was recorded in this session. */
  "session:violation": (payload: { sessionId: string; violationCount: number }) => void;
  /** Subscription was rejected (bad/again token, not owner). */
  "subscribe:error": (payload: { reason: string }) => void;
  /** Subscription accepted. */
  "subscribe:ok": (payload: { rooms: string[] }) => void;
}

export interface RealtimeClientEvents {
  subscribe: (message: RealtimeSubscribeMessage) => void;
  unsubscribe: (message: RealtimeSubscribeMessage) => void;
}
