import { ValidationError } from "@/domain/shared/errors";
import { ChallengeAmount } from "./challenge-amount";
import { MochimoAddress } from "./mochimo-address";
import type { RandomSource } from "@/domain/shared/ports";

export type RegistrationSettings = {
  /** Wallet that receives challenge payments. Absent when payment is waived. */
  depositAddress: { hex: string; tag: string } | null;
  /** How long a registrant has to pay. Sized around Mochimo's ~170s blocks. */
  claimTtlSeconds: number;
  /** Floor between two Mesh lookups for the same claim. */
  minCheckIntervalMs: number;
  /**
   * Free public-testing mode: no payment, no proof. Anyone can register any
   * address, so this belongs only on a throwaway beta database.
   */
  freeSignup: boolean;
};

/**
 * How this deployment lets people register a wallet.
 *
 * Keeping the paid and free variants side by side in one policy is what stops
 * "is sign-up free right now?" from being re-derived, differently, in the
 * route, the poller, and the form.
 */
export class RegistrationPolicy {
  constructor(private readonly settings: RegistrationSettings) {}

  get requiresPayment(): boolean {
    return !this.settings.freeSignup;
  }

  get claimTtlSeconds(): number {
    return this.settings.claimTtlSeconds;
  }

  get minCheckIntervalMs(): number {
    return this.settings.minCheckIntervalMs;
  }

  /** The wallet a registrant must pay. Throws when payment is required but unconfigured. */
  depositAddress(): { hex: string; tag: string } {
    const deposit = this.settings.depositAddress;
    if (!deposit) {
      throw new ValidationError(
        "registration.deposit.missing",
        "Registration wallet is not configured. Contact the admin.",
      );
    }
    return deposit;
  }

  /** Nobody may register the wallet that collects the payments. */
  assertNotDepositWallet(address: MochimoAddress): void {
    if (!this.requiresPayment) return;
    if (this.depositAddress().hex === address.hex) {
      throw new ValidationError(
        "registration.deposit.self",
        "That is the registration wallet, not yours.",
        "hex",
      );
    }
  }

  /** The amount this claim must be paid — zero when payment is waived. */
  challengeFor(taken: ReadonlySet<number>, random: RandomSource): ChallengeAmount {
    return this.requiresPayment ? ChallengeAmount.random(taken, random) : ChallengeAmount.none();
  }
}
