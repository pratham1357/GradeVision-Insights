import { Router } from "express";

import { validateBody } from "../../middleware/index.js";
import { getMe, getSession, postLogin, postLogout } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";
import { loginSchema } from "./auth.schema.js";

/**
 * Auth routes, mounted at `/api/v1/auth`:
 *   POST /login    validate -> controller -> service (opens a server-side session)
 *   GET  /me       authenticate -> current account
 *   GET  /session  authenticate -> current account + CSRF token
 *   POST /logout   authenticate (+CSRF for cookies) -> revoke session, clear cookie
 */
export const authRouter: Router = Router();

authRouter.post("/login", validateBody(loginSchema), postLogin);
authRouter.get("/me", ...requireAuth(), getMe);
authRouter.get("/session", ...requireAuth(), getSession);
authRouter.post("/logout", ...requireAuth(), postLogout);
