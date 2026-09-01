import type { InstructorCourse, InstructorSection } from "@gradevision/shared";

import { ApiError } from "../../utils/api-error.js";
import { findInstructorSection, listInstructorCourses } from "./courses.repository.js";

type SectionRow = Awaited<ReturnType<typeof findInstructorSection>>;
type CourseRow = Awaited<ReturnType<typeof listInstructorCourses>>[number];

function toSection(section: NonNullable<SectionRow>): InstructorSection {
  return {
    id: section.id,
    name: section.name,
    term: section.term,
    year: section.year,
    enrollmentCount: section._count.enrollments,
    course: { id: section.course.id, code: section.course.code, name: section.course.name },
  };
}

export async function getInstructorCourses(instructorId: string): Promise<InstructorCourse[]> {
  const courses = await listInstructorCourses(instructorId);
  return courses.map((course: CourseRow) => ({
    id: course.id,
    code: course.code,
    name: course.name,
    description: course.description,
    sections: course.sections.map((section) => ({
      id: section.id,
      name: section.name,
      term: section.term,
      year: section.year,
      enrollmentCount: section._count.enrollments,
      course: { id: course.id, code: course.code, name: course.name },
    })),
  }));
}

export async function getInstructorSection(
  sectionId: string,
  instructorId: string,
): Promise<InstructorSection> {
  const section = await findInstructorSection(sectionId, instructorId);
  if (!section) {
    // 404 (not 403) so a section id from another instructor is not confirmed to exist.
    throw ApiError.notFound("Section not found");
  }
  return toSection(section);
}
