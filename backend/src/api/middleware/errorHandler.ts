import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error("[API Error]", err.message);
  const status = (err as NodeJS.ErrnoException).code ? 500 : 500;
  res.status(status).json({ error: err.message || "Internal server error" });
}
