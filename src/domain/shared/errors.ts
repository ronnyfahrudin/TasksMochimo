/**
 * Domain errors.
 *
 * The domain layer never imports HTTP, Next, or Prisma — it signals failure by
 * throwing one of these. `src/interface/http/error-mapper.ts` is the only place
 * that knows how a domain failure becomes a status code, so the same use case
 * can be driven from an API route, a CLI script, or a test without change.
 */
export class DomainError extends Error {
  readonly code: string;
  /** Input field the caller should highlight, when the failure is about one. */
  readonly field?: string;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.field = field;
  }
}

/** Input violates an invariant of a value object or aggregate. */
export class ValidationError extends DomainError {}

/** The aggregate the caller referred to does not exist. */
export class NotFoundError extends DomainError {}

/** The action collides with existing state (duplicate wallet, username, …). */
export class ConflictError extends DomainError {}

/** The caller is not authenticated. */
export class UnauthenticatedError extends DomainError {
  constructor(message = "Unauthorized") {
    super("unauthenticated", message);
  }
}

/** The caller is authenticated but not allowed to do this. */
export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super("forbidden", message);
  }
}

/** The aggregate is not in a state where this action is legal (yet). */
export class PreconditionError extends DomainError {}

/** The aggregate existed but has lapsed — an expired claim, for instance. */
export class ExpiredError extends DomainError {}

/** The action is legal but the caller must wait (cooldown, throttle). */
export class TooSoonError extends DomainError {
  /** Seconds the caller should wait before retrying, when known. */
  readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, retryAfterSeconds?: number) {
    super(code, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
