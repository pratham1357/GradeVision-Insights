import type { Request, Response } from "express";

import { getAuthContext } from "../../middleware/index.js";
import { pathParam, sendData } from "../../utils/http.js";
import { getInstructorCourses, getInstructorSection } from "./courses.service.js";

/** `GET /api/v1/courses` - courses/sections the authenticated instructor teaches. */
export async function listCourses(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorCourses(userId));
}

/** `GET /api/v1/courses/sections/:sectionId` - one section the instructor owns. */
export async function getSection(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await getInstructorSection(pathParam(req, "sectionId"), userId));
}
