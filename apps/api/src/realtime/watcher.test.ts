import { describe, expect, it, vi } from "vitest";

import { RealtimeWatcher, type WatcherDb, type WatcherEmitter } from "./watcher.js";

function makeEmitter() {
  const session = vi.fn();
  const assessment = vi.fn();
  const emitter: WatcherEmitter = {
    toSession: session,
    toAssessment: assessment,
  };
  return { emitter, session, assessment };
}

describe("RealtimeWatcher", () => {
  it("emits session:changed once when activity is newer than the seed, then stays quiet", async () => {
    const { emitter, session } = makeEmitter();
    let activityAt = 0;
    const db: WatcherDb = {
      sessionActivity: (ids) =>
        Promise.resolve(ids.map((id) => ({ sessionId: id, at: activityAt }))),
      assessmentActivity: () => Promise.resolve([]),
    };
    const watcher = new RealtimeWatcher(emitter, db, 10_000);

    watcher.addSession("s1");
    await watcher.tick();
    expect(session).not.toHaveBeenCalled(); // seeded "now", no newer activity

    activityAt = Date.now() + 5_000;
    await watcher.tick();
    expect(session).toHaveBeenCalledTimes(1);
    expect(session).toHaveBeenCalledWith("s1", "session:changed", { sessionId: "s1" });

    await watcher.tick();
    expect(session).toHaveBeenCalledTimes(1); // same activity -> no re-emit

    watcher.stop();
  });

  it("emits assessment:changed for a subscribed assessment on new activity", async () => {
    const { emitter, assessment } = makeEmitter();
    let at = 0;
    const db: WatcherDb = {
      sessionActivity: () => Promise.resolve([]),
      assessmentActivity: (ids) => Promise.resolve(ids.map((id) => ({ assessmentId: id, at }))),
    };
    const watcher = new RealtimeWatcher(emitter, db, 10_000);
    watcher.addAssessment("a1");
    await watcher.tick();
    at = Date.now() + 1_000;
    await watcher.tick();
    expect(assessment).toHaveBeenCalledWith("a1", "assessment:changed", { assessmentId: "a1" });
    watcher.stop();
  });

  it("drops a scope only when the last subscriber leaves", async () => {
    const { emitter } = makeEmitter();
    const seen: string[] = [];
    const db: WatcherDb = {
      sessionActivity: (ids) => {
        seen.push(ids.join(","));
        return Promise.resolve([]);
      },
      assessmentActivity: () => Promise.resolve([]),
    };
    const watcher = new RealtimeWatcher(emitter, db, 10_000);
    watcher.addSession("s1");
    watcher.addSession("s1");
    watcher.removeSession("s1");
    await watcher.tick();
    expect(seen.at(-1)).toBe("s1");
    watcher.removeSession("s1");
    await watcher.tick();
    expect(seen.at(-1)).toBe("");
    watcher.stop();
  });
});
