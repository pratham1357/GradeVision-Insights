import { healthStatus } from "@gradevision/shared";
import cors from "cors";
import express, { type Express } from "express";

import { env } from "./env.js";

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json(healthStatus("api"));
  });

  return app;
}
