import type { CorsOptions } from "cors";
import { API_V1_PREFIX } from "@gradevision/shared";

import { env } from "../env.js";

/** Canonical mount point for the versioned API. */
export const API_PREFIX = API_V1_PREFIX;

/** Request body size cap. Kept small until an endpoint genuinely needs more. */
export const JSON_BODY_LIMIT = "1mb";

/** Maximum length accepted for an inbound `X-Request-Id` header. */
export const MAX_REQUEST_ID_LENGTH = 128;

export const corsOptions: CorsOptions = {
  origin: env.CORS_ORIGINS.includes("*") ? true : env.CORS_ORIGINS,
  credentials: true,
};

export { env };
