import { describe, expect, it, vi } from "vitest";

import { connectRealtime, type SocketFactory } from "./realtime";

vi.mock("./auth-storage", () => ({
  tokenStorage: { get: () => "test-token", set: vi.fn(), clear: vi.fn() },
}));

/** Minimal fake socket: records listeners and lets a test drive events. */
function fakeSocket() {
  const listeners = new Map<string, (payload?: unknown) => void>();
  return {
    emitted: [] as Array<{ event: string; payload: unknown }>,
    disconnected: false,
    on(event: string, cb: (payload?: unknown) => void) {
      listeners.set(event, cb);
    },
    emit(event: string, payload?: unknown) {
      this.emitted.push({ event, payload });
    },
    removeAllListeners() {
      listeners.clear();
    },
    disconnect() {
      this.disconnected = true;
    },
    fire(event: string, payload?: unknown) {
      listeners.get(event)?.(payload);
    },
  };
}

function harness() {
  const socket = fakeSocket();
  const factory = vi.fn(() => socket) as unknown as SocketFactory;
  const events = {
    onSessionChanged: vi.fn(),
    onAssessmentChanged: vi.fn(),
    onViolation: vi.fn(),
    onReady: vi.fn(),
    onStatus: vi.fn(),
  };
  const dispose = connectRealtime({ sessionId: "s1" }, events, factory);
  return { socket, events, dispose };
}

describe("connectRealtime", () => {
  it("subscribes on connect and reports connected only once subscribed", () => {
    const { socket, events } = harness();
    socket.fire("connect");
    expect(socket.emitted).toEqual([{ event: "subscribe", payload: { sessionId: "s1" } }]);
    expect(events.onStatus).not.toHaveBeenCalled(); // connected but not yet subscribed

    socket.fire("subscribe:ok", { rooms: ["session:s1"] });
    expect(events.onStatus).toHaveBeenLastCalledWith(true);
    expect(events.onReady).toHaveBeenCalledTimes(1); // resync-after-(re)connect hook
  });

  it("re-subscribes and re-syncs after a reconnect", () => {
    const { socket, events } = harness();
    socket.fire("connect");
    socket.fire("subscribe:ok", {});
    socket.fire("disconnect");
    expect(events.onStatus).toHaveBeenLastCalledWith(false); // -> polling resumes

    socket.fire("connect"); // reconnect
    socket.fire("subscribe:ok", {});
    expect(socket.emitted.filter((e) => e.event === "subscribe")).toHaveLength(2);
    expect(events.onReady).toHaveBeenCalledTimes(2);
  });

  it("routes server change events to the right handlers", () => {
    const { socket, events } = harness();
    socket.fire("session:changed", { sessionId: "s1" });
    socket.fire("assessment:changed", { assessmentId: "a1" });
    socket.fire("session:violation", { violationCount: 3 });
    expect(events.onSessionChanged).toHaveBeenCalledTimes(1);
    expect(events.onAssessmentChanged).toHaveBeenCalledTimes(1);
    expect(events.onViolation).toHaveBeenCalledWith(3);
  });

  it("falls back to polling on a connection error and cleans up on dispose", () => {
    const { socket, events, dispose } = harness();
    socket.fire("connect_error", new Error("boom"));
    expect(events.onStatus).toHaveBeenLastCalledWith(false);
    dispose();
    expect(socket.disconnected).toBe(true);
  });
});
