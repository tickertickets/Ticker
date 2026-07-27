/**
 * Centralized error hierarchy.
 *
 * Throw these from any layer (service, route, middleware) and the
 * centralised error-handler middleware will translate them into the
 * correct HTTP response automatically.
 *
 * Usage:
 *   throw new NotFoundError("ticket");
 *   throw new UnauthorizedError();
 *   throw new ValidationError("imdbId and movieTitle are required");
 */

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, "bad_request", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access denied") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, "not_found", `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

export class ExternalApiError extends AppError {
  constructor(message: string) {
    super(502, "external_api_error", message);
  }
}
