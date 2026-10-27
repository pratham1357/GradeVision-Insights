import type { Request, Response } from "express";

import { getAuthContext } from "../../middleware/index.js";
import { ApiError } from "../../utils/api-error.js";
import { pathParam, sendData } from "../../utils/http.js";
import {
  listUsersQuerySchema,
  type CreateUserInput,
  type SetPasswordInput,
  type UpdateUserInput,
} from "./admin.schema.js";
import {
  createUser,
  getAudit,
  getSections,
  getUsers,
  setPassword,
  updateUser,
} from "./admin.service.js";

export async function listUsersView(req: Request, res: Response): Promise<void> {
  const query = listUsersQuerySchema.safeParse(req.query);
  if (!query.success) throw ApiError.badRequest("Invalid filter");
  sendData(res, await getUsers(query.data));
}

export async function createUserView(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await createUser(req.body as CreateUserInput, userId), 201);
}

export async function updateUserView(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await updateUser(pathParam(req, "userId"), req.body as UpdateUserInput, userId));
}

export async function setPasswordView(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  sendData(res, await setPassword(pathParam(req, "userId"), req.body as SetPasswordInput, userId));
}

export async function listSectionsView(_req: Request, res: Response): Promise<void> {
  sendData(res, await getSections());
}

export async function listAuditView(_req: Request, res: Response): Promise<void> {
  sendData(res, await getAudit());
}
