import express, { Application } from "express";
import cors from "cors";
import { config } from "../config";
import { burnsRouter } from "./routes/burns";
import { certificatesRouter } from "./routes/certificates";
import { errorHandler } from "./middleware/errorHandler";

export function createServer(): Application {
  const app = express();

  // If CORS_ORIGINS is configured, restrict to those; otherwise allow all
  // (dev only — production must set CORS_ORIGINS to the frontend domain).
  const corsOptions = config.corsOrigins.length > 0
    ? { origin: config.corsOrigins }
    : {};
  app.use(cors(corsOptions));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/burns", burnsRouter);
  app.use("/certificates", certificatesRouter);

  app.use(errorHandler);

  return app;
}
