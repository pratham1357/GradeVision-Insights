import type { Request, Response } from "express";

import { sendData } from "../../utils/http.js";
import { getAuthContext } from "./auth.middleware.js";
import type { LoginInput } from "./auth.schema.js";
import { getCurrentAccount, login } from "./auth.service.js";

/** `POST /api/v1/auth/login` - body already validated by `loginSchema`. */
export async function postLogin(req: Request, res: Response): Promise<void> {
  const result = await login(req.body as LoginInput);
  sendData(res, result);
}

/** `GET /api/v1/auth/me` - requires a valid access token. */
export async function getMe(req: Request, res: Response): Promise<void> {
  const { userId } = getAuthContext(req);
  const account = await getCurrentAccount(userId);
  sendData(res, account);
}
