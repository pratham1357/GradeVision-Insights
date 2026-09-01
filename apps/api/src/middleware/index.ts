export { requestId } from "./request-id.js";
export { requestLogger } from "./request-logger.js";
export { errorHandler, notFoundHandler } from "./error-handler.js";
export { validateBody, validateParams } from "./validate.js";

// Authentication / authorization live with the auth module; re-exported here so
// feature modules import all middleware from one place.
export {
  authenticate,
  requireAuth,
  requireRole,
  getAuthContext,
} from "../modules/auth/auth.middleware.js";
