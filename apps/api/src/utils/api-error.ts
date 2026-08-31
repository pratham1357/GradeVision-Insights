/**
 * Application-level error carrying an HTTP status, a stable machine code, and a
 * client-safe message. The error handler is the only place that serialises it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = "Bad request", details?: unknown): ApiError {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static notFound(message = "Resource not found"): ApiError {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static internal(message = "An unexpected error occurred"): ApiError {
    return new ApiError(500, "INTERNAL_ERROR", message);
  }
}
