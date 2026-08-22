import { z } from "zod";
import { ValidationError } from "@/domain/shared/errors";

/**
 * A username. Case-folded on the way in so "Ronny" and "ronny" are one
 * account — the uniqueness rule and the normalization rule are the same rule,
 * so they live in one place.
 */
export class Username {
  private constructor(readonly value: string) {}

  static readonly schema = z
    .string({ required_error: "Username is required" })
    .trim()
    .min(3, "Username must be at least 3 characters")
    .max(24, "Username must be at most 24 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and _")
    .transform((v) => v.toLowerCase());

  static create(input: string): Username {
    const parsed = Username.schema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError("username.invalid", parsed.error.issues[0].message, "username");
    }
    return new Username(parsed.data);
  }

  static rehydrate(value: string): Username {
    return new Username(value);
  }

  toString(): string {
    return this.value;
  }
}

/**
 * A password still in plaintext. Exists so a raw string can never be mistaken
 * for a hash, and so the strength rule has an owner.
 */
export class PlainPassword {
  private constructor(readonly value: string) {}

  static readonly MIN_LENGTH = 8;
  static readonly MAX_LENGTH = 128;

  static create(input: string, confirmation?: string): PlainPassword {
    if (input.length < PlainPassword.MIN_LENGTH) {
      throw new ValidationError(
        "password.too_short",
        `Password must be at least ${PlainPassword.MIN_LENGTH} characters`,
        "password",
      );
    }
    if (input.length > PlainPassword.MAX_LENGTH) {
      throw new ValidationError(
        "password.too_long",
        `Password is too long (max ${PlainPassword.MAX_LENGTH})`,
        "password",
      );
    }
    if (confirmation !== undefined && input !== confirmation) {
      throw new ValidationError(
        "password.mismatch",
        "Passwords do not match",
        "confirmPassword",
      );
    }
    return new PlainPassword(input);
  }

  /** Never let a password reach a log line by accident. */
  toString(): string {
    return "[redacted]";
  }
}

/** An opaque, already-hashed password. */
export class PasswordHash {
  private constructor(readonly value: string) {}

  static rehydrate(value: string): PasswordHash {
    return new PasswordHash(value);
  }

  toString(): string {
    return "[redacted]";
  }
}

export type UserRole = "USER" | "MODERATOR" | "ADMIN";
