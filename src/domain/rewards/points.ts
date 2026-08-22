import { ValidationError } from "@/domain/shared/errors";

/** A points amount. Whole numbers only; the ledger is an integer ledger. */
export class Points {
  private constructor(readonly value: number) {}

  static of(value: number): Points {
    if (!Number.isInteger(value)) {
      throw new ValidationError("points.not_integer", "Points must be a whole number");
    }
    return new Points(value);
  }

  static zero(): Points {
    return new Points(0);
  }

  get isZero(): boolean {
    return this.value === 0;
  }

  plus(other: Points): Points {
    return new Points(this.value + other.value);
  }
}
