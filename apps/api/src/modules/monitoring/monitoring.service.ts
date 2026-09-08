import { setTimeout as delay } from "node:timers/promises";

import type {
  EvaluationRunStatus,
  InstructorMonitorSummary,
  InstructorStudentActivity,
  InstructorStudentMonitor,
  MonitoredLatestSubmission,
  SystemMetrics,
} from "@gradevision/shared";

import { pingDatabase } from "../../services/database.js";
import { requestMetrics } from "../../services/request-metrics.js";
import {
  listInstructorSectionsWithAssessmentCounts,
  listInstructorStudents,
  type InstructorStudentRow,
} from "./monitoring.repository.js";

/** CPU sample window. Short enough to keep the endpoint responsive. */
const CPU_SAMPLE_MS = 120;
/** Flag threshold - the same one the assessment results view uses. */
const FLAG_THRESHOLD = 3;

function round(value: number): number {
  return Math.round(value);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function laterIso(a: string | null, b: Date | null | undefined): string | null {
  if (!b) return a;
  const bIso = b.toISOString();
  if (!a) return bIso;
  return bIso > a ? bIso : a;
}

function scorePercentOf(
  run: { totalScore: unknown; maxScore: unknown } | undefined,
): number | null {
  if (!run || run.totalScore == null || run.maxScore == null) return null;
  const total = Number(run.totalScore);
  const max = Number(run.maxScore);
  if (!(max > 0)) return null;
  return round((total / max) * 100);
}

function toActivity(
  student: InstructorStudentRow,
  assessmentsBySectionId: Map<string, number>,
): InstructorStudentActivity {
  const sections = student.enrollments.map((e) => ({
    id: e.section.id,
    name: e.section.name,
    courseCode: e.section.course.code,
  }));

  const enrolledAt =
    student.enrollments.length > 0
      ? student.enrollments.map((e) => e.createdAt.toISOString()).sort()[0]!
      : null;

  const assessmentsAssigned = student.enrollments.reduce(
    (sum, e) => sum + (assessmentsBySectionId.get(e.section.id) ?? 0),
    0,
  );

  let assessmentsStarted = 0;
  let assessmentsSubmitted = 0;
  let inProgress = false;
  let submissionCount = 0;
  let violationCount = 0;
  let lastActivityAt: string | null = null;
  const scorePercents: number[] = [];
  let latestSubmission: MonitoredLatestSubmission | null = null;

  for (const session of student.examSessions) {
    if (session.startedAt) assessmentsStarted += 1;
    if (session.status === "SUBMITTED" || session.status === "EXPIRED") assessmentsSubmitted += 1;
    if (session.status === "IN_PROGRESS") inProgress = true;
    violationCount += session._count.violations;
    lastActivityAt = laterIso(lastActivityAt, session.updatedAt);
    lastActivityAt = laterIso(lastActivityAt, session.violations[0]?.occurredAt ?? null);

    for (const submission of session.submissions) {
      submissionCount += 1;
      const run = submission.evaluationRuns[0];
      const pct = scorePercentOf(run);
      if (run?.status === "COMPLETED" && pct !== null) scorePercents.push(pct);
      lastActivityAt = laterIso(lastActivityAt, submission.createdAt);

      const submittedAt = submission.createdAt.toISOString();
      if (!latestSubmission || submittedAt > latestSubmission.submittedAt) {
        latestSubmission = {
          submissionId: submission.id,
          assessmentId: session.assessmentId,
          questionTitle: submission.question.title,
          submissionStatus: submission.status,
          evaluationStatus: (run?.status as EvaluationRunStatus | undefined) ?? null,
          scorePercent: pct,
          submittedAt,
        };
      }
    }
  }

  return {
    studentId: student.id,
    name: student.name,
    email: student.email,
    sections,
    enrolledAt,
    assessmentsAssigned,
    assessmentsStarted,
    assessmentsSubmitted,
    inProgress,
    submissionCount,
    latestSubmission,
    averageScorePercent: mean(scorePercents),
    violationCount,
    flagged: violationCount >= FLAG_THRESHOLD,
    lastActivityAt,
  };
}

function summarise(
  students: InstructorStudentActivity[],
  sectionsCount: number,
): InstructorMonitorSummary {
  const perStudentAverages = students
    .map((s) => s.averageScorePercent)
    .filter((v): v is number => v !== null);
  return {
    totalStudents: students.length,
    sectionsCount,
    inProgressCount: students.filter((s) => s.inProgress).length,
    submittedCount: students.filter((s) => s.assessmentsSubmitted > 0).length,
    averageScorePercent: mean(perStudentAverages),
    totalViolations: students.reduce((sum, s) => sum + s.violationCount, 0),
    flaggedStudents: students.filter((s) => s.flagged).length,
  };
}

export async function getInstructorStudentMonitor(
  instructorId: string,
): Promise<InstructorStudentMonitor> {
  const [sections, studentRows] = await Promise.all([
    listInstructorSectionsWithAssessmentCounts(instructorId),
    listInstructorStudents(instructorId),
  ]);

  const assessmentsBySectionId = new Map(
    sections.map((s) => [s.id, s._count.assessments] as const),
  );

  const students = studentRows.map((row) => toActivity(row, assessmentsBySectionId));

  return {
    students,
    summary: summarise(students, sections.length),
    generatedAt: new Date().toISOString(),
  };
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  // CPU: a short real sample of this process only (not the host).
  const cpuBefore = process.cpuUsage();
  const sampleStart = performance.now();
  await delay(CPU_SAMPLE_MS);
  const sampleMs = performance.now() - sampleStart;
  const cpuDiff = process.cpuUsage(cpuBefore);
  const userMs = cpuDiff.user / 1000;
  const systemMs = cpuDiff.system / 1000;

  const mem = process.memoryUsage();
  const db = await pingDatabase();
  const requests = requestMetrics.snapshot();

  return {
    process: {
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    },
    cpu: {
      userMs: Math.round(userMs * 100) / 100,
      systemMs: Math.round(systemMs * 100) / 100,
      percent: sampleMs > 0 ? Math.round(((userMs + systemMs) / sampleMs) * 100) : null,
      sampleMs: Math.round(sampleMs),
    },
    memory: {
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
    },
    requests: {
      inFlight: requests.inFlight,
      total: requests.total,
      lastResponseTimeMs: requests.lastResponseTimeMs,
      averageResponseTimeMs: requests.averageResponseTimeMs,
      sampleSize: requests.sampleSize,
    },
    database: { status: db.ok ? "up" : "down", latencyMs: db.ok ? db.latencyMs : null },
    generatedAt: new Date().toISOString(),
  };
}
