import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";

/**
 * Centralized Express error-handling middleware.
 *
 * Must be registered LAST in app.ts (after all routes).
 * Catches every error thrown with `next(err)` or thrown inside async route
 * handlers (when wrapped with asyncHandler).
 *
 * Produces a consistent JSON envelope:
 *   { error: string; message: string }
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    // Known, expected errors — log at warn level, not error
    logger.warn({ err, url: req.url, method: req.method }, `AppError: ${err.code}`);
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  // Unknown / unexpected errors — log at error level with full detail
  logger.error({ err, url: req.url, method: req.method }, "Unhandled server error");
  res.status(500).json({
    error: "internal_error",
    message: "An unexpected error occurred",
  });
}

/**
 * Wraps an async Express route handler so that any rejected promise or thrown
 * error is forwarded to the error-handling middleware via `next(err)`.
 *
 * Usage:
 *   router.get("/", asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
