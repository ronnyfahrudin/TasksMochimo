import {
  ConflictError,
  ExpiredError,
  PreconditionError,
  ValidationError,
} from "@/domain/shared/errors";
import type { RandomSource } from "@/domain/shared/ports";
import { ChallengeAmount } from "./challenge-amount";
import { MochimoAddress } from "./mochimo-address";

export type WalletClaimSnapshot = {
  id: string | null;
  claimToken: string;
  hex: string;
  tag: string;
  challengeNanoMcm: number;
  startedAt: Date;
  expiresAt: Date;
  lastCheckedAt: Date | null;
  verifiedAt: Date | null;
  verifiedTxHash: string | null;
  consumedAt: Date | null;
};

/** Written to `verifiedTxHash` when registration waived the payment. */
export const FREE_SIGNUP_TX_MARKER = "FREE_SIGNUP_NO_PAYMENT";

/**
 * Aggregate root for proof of wallet ownership.
 *
 * Lifecycle: opened → (payment observed) verified → consumed by sign-up.
 * Every transition is a method here, so no caller can e.g. consume a claim
 * that was never verified, or revive an expired one — the states that used to
 * be enforced by a chain of `if`s spread across two route handlers.
 */
export class WalletClaim {
  private constructor(
    private _id: string | null,
    readonly claimToken: string,
    readonly address: MochimoAddress,
    readonly challenge: ChallengeAmount,
    readonly startedAt: Date,
    readonly expiresAt: Date,
    private _lastCheckedAt: Date | null,
    private _verifiedAt: Date | null,
    private _verifiedTxHash: string | null,
    private _consumedAt: Date | null,
  ) {}

  /**
   * Open a new claim.
   *
   * `preVerified` is the free-signup path: the claim is born verified because
   * no payment will ever arrive. It proves nothing, and `provenByPayment`
   * stays false so the UI can never call it a verified wallet.
   */
  static open(params: {
    address: MochimoAddress;
    challenge: ChallengeAmount;
    ttlSeconds: number;
    random: RandomSource;
    now: Date;
    preVerified?: boolean;
  }): WalletClaim {
    if (params.ttlSeconds <= 0) {
      throw new ValidationError("claim.ttl.invalid", "Claim TTL must be positive");
    }
    if (params.preVerified !== true && params.challenge.isZero) {
      throw new ValidationError(
        "claim.challenge.zero",
        "A claim that requires payment cannot have a zero challenge",
      );
    }
    const expiresAt = new Date(+params.now + params.ttlSeconds * 1000);
    return new WalletClaim(
      null,
      params.random.token(32),
      params.address,
      params.challenge,
      params.now,
      expiresAt,
      null,
      params.preVerified ? params.now : null,
      params.preVerified ? FREE_SIGNUP_TX_MARKER : null,
      null,
    );
  }

  static rehydrate(s: WalletClaimSnapshot): WalletClaim {
    return new WalletClaim(
      s.id,
      s.claimToken,
      MochimoAddress.rehydrate(s.hex, s.tag),
      ChallengeAmount.fromNano(s.challengeNanoMcm),
      s.startedAt,
      s.expiresAt,
      s.lastCheckedAt,
      s.verifiedAt,
      s.verifiedTxHash,
      s.consumedAt,
    );
  }

  get id(): string | null {
    return this._id;
  }

  get verifiedAt(): Date | null {
    return this._verifiedAt;
  }

  get verifiedTxHash(): string | null {
    return this._verifiedTxHash;
  }

  get consumedAt(): Date | null {
    return this._consumedAt;
  }

  get lastCheckedAt(): Date | null {
    return this._lastCheckedAt;
  }

  get isVerified(): boolean {
    return this._verifiedAt !== null;
  }

  get isConsumed(): boolean {
    return this._consumedAt !== null;
  }

  isExpired(now: Date): boolean {
    return +this.expiresAt <= +now;
  }

  remainingSeconds(now: Date): number {
    return Math.max(0, Math.floor((+this.expiresAt - +now) / 1000));
  }

  /** Whether a real on-chain payment backs this claim. */
  get provenByPayment(): boolean {
    return this.isVerified && this._verifiedTxHash !== FREE_SIGNUP_TX_MARKER;
  }

  /** Whether the holder still owes us a payment for this claim to verify. */
  get awaitsPayment(): boolean {
    return !this.isVerified && !this.challenge.isZero;
  }

  /**
   * Whether a Mesh lookup is allowed right now. The public node is slow and
   * shared, so overlapping polls must not stack up on it.
   */
  throttledFor(now: Date, minIntervalMs: number): number {
    if (!this._lastCheckedAt) return 0;
    const sinceLast = +now - +this._lastCheckedAt;
    return sinceLast >= minIntervalMs ? 0 : Math.ceil((minIntervalMs - sinceLast) / 1000);
  }

  /** Reserve the throttle slot before doing the (slow) lookup. */
  markChecked(now: Date): void {
    this._lastCheckedAt = now;
  }

  markVerified(txHash: string, now: Date): void {
    if (this.isConsumed) {
      throw new ConflictError("claim.consumed", "Claim already used to create an account.");
    }
    if (this.isExpired(now)) {
      throw new ExpiredError("claim.expired", "Wallet claim expired. Start over.");
    }
    if (this.isVerified) return; // idempotent: two polls can race to the same payment
    this._verifiedAt = now;
    this._verifiedTxHash = txHash;
  }

  /** Spend the claim to create an account. One claim, one account, ever. */
  consume(now: Date): void {
    if (this.isConsumed) {
      throw new ConflictError("claim.consumed", "Wallet claim already used.", "claimToken");
    }
    if (this.isExpired(now)) {
      throw new ExpiredError("claim.expired", "Wallet claim expired. Start over.", "claimToken");
    }
    if (!this.isVerified) {
      throw new PreconditionError(
        "claim.unverified",
        "Wallet not yet verified. Trigger a transaction from your wallet first.",
        "claimToken",
      );
    }
    this._consumedAt = now;
  }

  assignId(id: string): void {
    this._id = id;
  }

  toSnapshot(): WalletClaimSnapshot {
    return {
      id: this._id,
      claimToken: this.claimToken,
      hex: this.address.hex,
      tag: this.address.tag,
      challengeNanoMcm: this.challenge.nanoMcm,
      startedAt: this.startedAt,
      expiresAt: this.expiresAt,
      lastCheckedAt: this._lastCheckedAt,
      verifiedAt: this._verifiedAt,
      verifiedTxHash: this._verifiedTxHash,
      consumedAt: this._consumedAt,
    };
  }
}
