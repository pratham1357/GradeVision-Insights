import { prisma } from "../services/database.js";
import { logger } from "../utils/logger.js";

/**
 * Server-side change watcher for realtime updates.
 *
 * The API cannot observe the evaluator's database writes directly, so while a
 * client is subscribed the watcher polls for the newest `EvaluationRun` /
 * `Violation` timestamp per subscribed scope and emits a lightweight
 * "something changed, re-fetch" signal. Clients that lose the socket fall back
 * to their own interval polling, so this is a pure enhancement.
 */
export interface WatcherEmitter {
  toSession(sessionId: string, event: "session:changed", payload: { sessionId: string }): void;
  toAssessment(
    assessmentId: string,
    event: "assessment:changed",
    payload: { assessmentId: string },
  ): void;
}

export interface WatcherDb {
  sessionActivity(sessionIds: string[]): Promise<{ sessionId: string; at: number }[]>;
  assessmentActivity(assessmentIds: string[]): Promise<{ assessmentId: string; at: number }[]>;
}

const realDb: WatcherDb = {
  async sessionActivity(sessionIds) {
    if (sessionIds.length === 0) return [];
    const [runs, sessions] = await Promise.all([
      prisma.evaluationRun.findMany({
        where: { submission: { examSessionId: { in: sessionIds } } },
        select: { updatedAt: true, submission: { select: { examSessionId: true } } },
      }),
      // Session row itself (status change) + its assessment (instructor edited it).
      prisma.examSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, updatedAt: true, assessment: { select: { updatedAt: true } } },
      }),
    ]);
    const latest = new Map<string, number>();
    const bump = (key: string, ms: number) => latest.set(key, Math.max(latest.get(key) ?? 0, ms));
    for (const run of runs) bump(run.submission.examSessionId, run.updatedAt.getTime());
    for (const sn of sessions) {
      bump(sn.id, sn.updatedAt.getTime());
      bump(sn.id, sn.assessment.updatedAt.getTime());
    }
    return [...latest].map(([sessionId, at]) => ({ sessionId, at }));
  },
  async assessmentActivity(assessmentIds) {
    if (assessmentIds.length === 0) return [];
    const [runs, violations, assessments] = await Promise.all([
      prisma.evaluationRun.findMany({
        where: { submission: { examSession: { assessmentId: { in: assessmentIds } } } },
        select: {
          updatedAt: true,
          submission: { select: { examSession: { select: { assessmentId: true } } } },
        },
      }),
      prisma.violation.findMany({
        where: { examSession: { assessmentId: { in: assessmentIds } } },
        select: { occurredAt: true, examSession: { select: { assessmentId: true } } },
      }),
      // The assessment row itself + any of its sessions changing (start / submit).
      prisma.assessment.findMany({
        where: { id: { in: assessmentIds } },
        select: {
          id: true,
          updatedAt: true,
          examSessions: { select: { updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 },
        },
      }),
    ]);
    const latest = new Map<string, number>();
    const bump = (key: string, ms: number) => latest.set(key, Math.max(latest.get(key) ?? 0, ms));
    for (const run of runs) bump(run.submission.examSession.assessmentId, run.updatedAt.getTime());
    for (const v of violations) bump(v.examSession.assessmentId, v.occurredAt.getTime());
    for (const a of assessments) {
      bump(a.id, a.updatedAt.getTime());
      if (a.examSessions[0]) bump(a.id, a.examSessions[0].updatedAt.getTime());
    }
    return [...latest].map(([assessmentId, at]) => ({ assessmentId, at }));
  },
};

export class RealtimeWatcher {
  private readonly sessions = new Map<string, number>(); // id -> ref count
  private readonly assessments = new Map<string, number>();
  private readonly lastSeenSession = new Map<string, number>();
  private readonly lastSeenAssessment = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly emitter: WatcherEmitter,
    private readonly db: WatcherDb = realDb,
    private readonly intervalMs = 3_000,
  ) {}

  private ref(map: Map<string, number>, id: string): void {
    map.set(id, (map.get(id) ?? 0) + 1);
  }

  private unref(map: Map<string, number>, id: string): void {
    const next = (map.get(id) ?? 0) - 1;
    if (next <= 0) map.delete(id);
    else map.set(id, next);
  }

  addSession(sessionId: string): void {
    this.ref(this.sessions, sessionId);
    // Seed so we don't immediately re-announce state the client just fetched.
    if (!this.lastSeenSession.has(sessionId)) this.lastSeenSession.set(sessionId, Date.now());
    this.ensureTimer();
  }

  removeSession(sessionId: string): void {
    this.unref(this.sessions, sessionId);
    if (!this.sessions.has(sessionId)) this.lastSeenSession.delete(sessionId);
    this.maybeStop();
  }

  addAssessment(assessmentId: string): void {
    this.ref(this.assessments, assessmentId);
    if (!this.lastSeenAssessment.has(assessmentId)) {
      this.lastSeenAssessment.set(assessmentId, Date.now());
    }
    this.ensureTimer();
  }

  removeAssessment(assessmentId: string): void {
    this.unref(this.assessments, assessmentId);
    if (!this.assessments.has(assessmentId)) this.lastSeenAssessment.delete(assessmentId);
    this.maybeStop();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  private maybeStop(): void {
    if (this.timer && this.sessions.size === 0 && this.assessments.size === 0) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One poll cycle. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sessionIds = [...this.sessions.keys()];
      const assessmentIds = [...this.assessments.keys()];

      const [sessionActivity, assessmentActivity] = await Promise.all([
        this.db.sessionActivity(sessionIds),
        this.db.assessmentActivity(assessmentIds),
      ]);

      for (const { sessionId, at } of sessionActivity) {
        if (at > (this.lastSeenSession.get(sessionId) ?? 0)) {
          this.lastSeenSession.set(sessionId, at);
          this.emitter.toSession(sessionId, "session:changed", { sessionId });
        }
      }
      for (const { assessmentId, at } of assessmentActivity) {
        if (at > (this.lastSeenAssessment.get(assessmentId) ?? 0)) {
          this.lastSeenAssessment.set(assessmentId, at);
          this.emitter.toAssessment(assessmentId, "assessment:changed", { assessmentId });
        }
      }
    } catch (error) {
      logger.warn("realtime watcher tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running = false;
    }
  }
}
