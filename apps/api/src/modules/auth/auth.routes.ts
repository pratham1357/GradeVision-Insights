import { Router } from "express";

import { validateBody } from "../../middleware/index.js";
import { getMe, postLogin } from "./auth.controller.js";
import { requireAuth } from "./auth.middleware.js";
import { loginSchema } from "./auth.schema.js";

/**
 * Auth module: routes only wire middleware to controllers.
 *   POST /api/v1/auth/login   validate -> controller -> service
 *   GET  /api/v1/auth/me      authenticate -> controller -> service
 *
 * Deferred: register, logout, refresh, password reset, SSO.
 */
export const authRouter: Router = Router();

authRouter.post("/login", validateBody(loginSchema), postLogin);
authRouter.get("/me", ...requireAuth(), getMe);
