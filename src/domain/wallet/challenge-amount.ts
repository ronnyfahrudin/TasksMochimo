import { ValidationError } from "@/domain/shared/errors";
import type { RandomSource } from "@/domain/shared/ports";

/**
 * The exact amount a registrant must send to prove they hold the wallet keys.
 *
 * Mochimo's WOTS+ keys are one-time-use, so there is no "sign this message" —
 * a payment of an unpredictable amount is the available proof. The amount is
 * the secret, so it must be unique among live claims: two users verified by
 * one payment would break the whole scheme.
 */
export class ChallengeAmount {
  /** Small enough to be cheap, large enough that guessing is pointless. */
  static readonly MIN_NANO = 100;
  static readonly MAX_NANO = 999_999; // ~0.000999999 MCM

  private constructor(readonly nanoMcm: number) {}

  static fromNano(nanoMcm: number): ChallengeAmount {
    if (!Number.isInteger(nanoMcm) || nanoMcm < 0) {
      throw new ValidationError("challenge.invalid", "Challenge must be a whole number of nMCM");
    }
    return new ChallengeAmount(nanoMcm);
  }

  /**
   * Zero — used only when registration waives the payment entirely. A zero
   * challenge can never be satisfied by a real transaction, so a claim
   * carrying one must have been verified some other way.
   */
  static none(): ChallengeAmount {
    return new ChallengeAmount(0);
  }

  /**
   * Pick an amount no live claim is already waiting on.
   *
   * @param taken amounts currently reserved by unexpired, unconsumed claims
   */
  static random(taken: ReadonlySet<number>, random: RandomSource): ChallengeAmount {
    for (let attempt = 0; attempt < 50; attempt++) {
      const n = random.int(ChallengeAmount.MIN_NANO, ChallengeAmount.MAX_NANO);
      if (!taken.has(n)) return new ChallengeAmount(n);
    }
    // The space is ~10^6 wide; exhausting 50 tries means something is very
    // wrong (a flood of open claims), and issuing a duplicate would be worse.
    throw new ValidationError(
      "challenge.exhausted",
      "Could not allocate a unique challenge amount. Try again shortly.",
    );
  }

  get isZero(): boolean {
    return this.nanoMcm === 0;
  }

  /** Display form in MCM, e.g. 213972 → "0.000213972". */
  toMcm(): string {
    return (this.nanoMcm / 1e9).toFixed(9);
  }

  equals(other: ChallengeAmount): boolean {
    return this.nanoMcm === other.nanoMcm;
  }
}
