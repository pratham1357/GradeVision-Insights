import { prisma } from "../../services/database.js";

/** Courses in which the instructor teaches at least one section (their sections only). */
export function listInstructorCourses(instructorId: string) {
  return prisma.course.findMany({
    where: { sections: { some: { instructorId } } },
    orderBy: { code: "asc" },
    include: {
      sections: {
        where: { instructorId },
        orderBy: { name: "asc" },
        include: { _count: { select: { enrollments: true } } },
      },
    },
  });
}

/** A single section, only if it is taught by this instructor (null otherwise). */
export function findInstructorSection(sectionId: string, instructorId: string) {
  return prisma.section.findFirst({
    where: { id: sectionId, instructorId },
    include: {
      course: true,
      _count: { select: { enrollments: true } },
    },
  });
}
