import { NextResponse } from "next/server";
import {
  ConflictError,
  DomainError,
  ExpiredError,
  ForbiddenError,
  NotFoundError,
  PreconditionError,
  TooSoonError,
  UnauthenticatedError,
  ValidationError,
} from "@/domain/shared/errors";

/**
 * The single translation from domain failure to HTTP.
 *
 * Keeping it here is what lets the use cases stay transport-agnostic: they
 * throw meaning ("this claim expired"), and exactly one module decides that
 * means 410.
 */
function statusFor(error: DomainError): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof UnauthenticatedError) return 401;
  if (error instanceof ForbiddenError) return 403;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  if (error instanceof ExpiredError) return 410;
  if (error instanceof PreconditionError) return 412;
  if (error instanceof TooSoonError) return 429;
  return 400;
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    const status = statusFor(error);
    const headers =
      error instanceof TooSoonError && error.retryAfterSeconds
        ? { "Retry-After": String(error.retryAfterSeconds) }
        : undefined;

    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.field ? { field: error.field } : {}) },
      { status, headers },
    );
  }

  // Anything else is a bug, not a rejection: log it and stay vague to the caller.
  console.error("[unhandled]", error);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
