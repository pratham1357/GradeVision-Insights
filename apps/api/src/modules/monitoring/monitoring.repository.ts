import { prisma } from "../../services/database.js";

/**
 * All data access here is scoped to the sections the instructor teaches
 * (`section.instructorId === instructorId`). An instructor can never observe a
 * student, session, submission, or violation outside their own sections.
 */

/** Non-draft assessment statuses a student could have been assigned. */
const ASSIGNED_STATUSES = ["SCHEDULED", "ACTIVE", "CLOSED", "ARCHIVED"] as const;

/** The instructor's sections, each with its count of assigned (non-draft) assessments. */
export function listInstructorSectionsWithAssessmentCounts(instructorId: string) {
  return prisma.section.findMany({
    where: { instructorId },
    select: {
      id: true,
      name: true,
      course: { select: { code: true } },
      _count: {
        select: { assessments: { where: { status: { in: [...ASSIGNED_STATUSES] } } } },
      },
    },
  });
}

/**
 * Every student with an ACTIVE enrolment in one of the instructor's sections,
 * together with that student's sessions / submissions / violations for the
 * instructor's assessments only.
 */
export function listInstructorStudents(instructorId: string) {
  return prisma.user.findMany({
    where: {
      role: "STUDENT",
      enrollments: { some: { status: "ACTIVE", section: { instructorId } } },
    },
    orderBy: { name: "asc" },
    include: {
      enrollments: {
        where: { status: "ACTIVE", section: { instructorId } },
        select: {
          createdAt: true,
          section: { select: { id: true, name: true, course: { select: { code: true } } } },
        },
      },
      examSessions: {
        where: { assessment: { section: { instructorId } } },
        select: {
          id: true,
          status: true,
          startedAt: true,
          submittedAt: true,
          updatedAt: true,
          assessmentId: true,
          _count: { select: { violations: true } },
          violations: { select: { occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 1 },
          submissions: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              createdAt: true,
              question: { select: { title: true } },
              evaluationRuns: {
                where: { runNumber: 1 },
                select: { status: true, totalScore: true, maxScore: true },
              },
            },
          },
        },
      },
    },
  });
}

export type InstructorStudentRow = Awaited<ReturnType<typeof listInstructorStudents>>[number];
