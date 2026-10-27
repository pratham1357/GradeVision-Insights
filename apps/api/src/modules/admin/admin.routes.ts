import { Router } from "express";

import { requireRole, validateBody, validateParams } from "../../middleware/index.js";
import {
  createUserView,
  listAuditView,
  listSectionsView,
  listUsersView,
  setPasswordView,
  updateUserView,
} from "./admin.controller.js";
import {
  createUserSchema,
  setPasswordSchema,
  updateUserSchema,
  userParamsSchema,
} from "./admin.schema.js";

/**
 * Account management - ADMIN only (system health stays under /monitoring).
 *   GET   /admin/users                   list/search (?search=&role=&status=)
 *   POST  /admin/users                   create (optionally enrol a student)
 *   PATCH /admin/users/:userId           name / role / active (last-admin protected)
 *   POST  /admin/users/:userId/password  set a new password (ends their sessions)
 *   GET   /admin/sections                sections for enrolment
 *   GET   /admin/audit                   recent audit events
 */
export const adminRouter: Router = Router();

adminRouter.use(...requireRole("ADMIN"));

adminRouter.get("/users", listUsersView);
adminRouter.post("/users", validateBody(createUserSchema), createUserView);
adminRouter.patch(
  "/users/:userId",
  validateParams(userParamsSchema),
  validateBody(updateUserSchema),
  updateUserView,
);
adminRouter.post(
  "/users/:userId/password",
  validateParams(userParamsSchema),
  validateBody(setPasswordSchema),
  setPasswordView,
);
adminRouter.get("/sections", listSectionsView);
adminRouter.get("/audit", listAuditView);
