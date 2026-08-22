import { ValidationError } from "./errors";

/**
 * A leaderboard period: one UTC calendar month, "YYYY-MM".
 *
 * Points reset per period while lifetime points accumulate across all of them,
 * so the period boundary is a domain concept, not a formatting detail.
 */
export class Period {
  private constructor(readonly value: string) {}

  static fromString(value: string): Period {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new ValidationError("period.invalid", `Not a YYYY-MM period: ${value}`);
    }
    return new Period(value);
  }

  static current(now: Date = new Date()): Period {
    return new Period(
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }

  static previous(now: Date = new Date()): Period {
    return Period.current(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    );
  }

  equals(other: Period): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
