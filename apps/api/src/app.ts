import cors from "cors";
import express, { type Express } from "express";

import { API_PREFIX, JSON_BODY_LIMIT, corsOptions } from "./config/index.js";
import {
  errorHandler,
  notFoundHandler,
  requestId,
  requestLogger,
  requestMetricsMiddleware,
} from "./middleware/index.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { apiRouter } from "./routes/index.js";

/**
 * Builds and configures the Express application. No network side effects here -
 * starting the HTTP server and process lifecycle live in `server.ts`.
 */
export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");

  // Observability
  app.use(requestId);
  app.use(requestLogger);
  app.use(requestMetricsMiddleware);

  // Security / parsing baseline
  app.use(cors(corsOptions));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));

  // Canonical versioned API
  app.use(API_PREFIX, apiRouter);

  // Back-compat: keep the unversioned health route working for now.
  app.use("/health", healthRouter);

  // Terminal handlers (order matters)
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
