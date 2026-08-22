import { ConflictError } from "@/domain/shared/errors";
import type { Clock, RandomSource } from "@/domain/shared/ports";
import type { UserRepository } from "@/domain/identity/ports";
import { MochimoAddress } from "@/domain/wallet/mochimo-address";
import type { RegistrationPolicy } from "@/domain/wallet/registration-policy";
import type { WalletClaimRepository } from "@/domain/wallet/ports";
import { WalletClaim } from "@/domain/wallet/wallet-claim";

export type StartWalletClaimInput = { hex: string; tag: string };

export type StartWalletClaimOutput = {
  claimToken: string;
  claimId: string;
  expiresAt: Date;
  ttlSeconds: number;
  /** Absent when this deployment waives the payment. */
  payment: {
    challengeMcm: string;
    challengeNanoMcm: number;
    depositTag: string;
    depositHex: string;
  } | null;
  instructions: string;
};

/**
 * Open a proof-of-ownership claim.
 *
 * Rejects a wallet that is already registered before anyone spends MCM on it —
 * paying to verify a wallet you could never claim is the one failure mode that
 * actually costs the user money.
 */
export class StartWalletClaim {
  constructor(
    private readonly claims: WalletClaimRepository,
    private readonly users: UserRepository,
    private readonly policy: RegistrationPolicy,
    private readonly random: RandomSource,
    private readonly clock: Clock,
  ) {}

  async execute(input: StartWalletClaimInput): Promise<StartWalletClaimOutput> {
    const address = MochimoAddress.create(input);
    this.policy.assertNotDepositWallet(address);

    const existing = await this.users.findConflicting({ address });
    if (existing) {
      throw new ConflictError(
        "wallet.registered",
        "This wallet is already registered. Sign in instead.",
      );
    }

    const now = this.clock.now();
    const taken = await this.claims.liveChallengeAmounts(now);
    const challenge = this.policy.challengeFor(taken, this.random);

    const claim = await this.claims.save(
      WalletClaim.open({
        address,
        challenge,
        ttlSeconds: this.policy.claimTtlSeconds,
        random: this.random,
        now,
        preVerified: !this.policy.requiresPayment,
      }),
    );

    // Best-effort housekeeping; a failure here must never fail a sign-up.
    void this.claims.purgeExpired(now).catch(() => {});

    if (!this.policy.requiresPayment) {
      return {
        claimToken: claim.claimToken,
        claimId: claim.id!,
        expiresAt: claim.expiresAt,
        ttlSeconds: this.policy.claimTtlSeconds,
        payment: null,
        instructions:
          "Free public-testing mode: wallet ownership is NOT verified. Pick a username and password to finish.",
      };
    }

    const deposit = this.policy.depositAddress();
    const challengeMcm = claim.challenge.toMcm();
    return {
      claimToken: claim.claimToken,
      claimId: claim.id!,
      expiresAt: claim.expiresAt,
      ttlSeconds: this.policy.claimTtlSeconds,
      payment: {
        challengeMcm,
        challengeNanoMcm: claim.challenge.nanoMcm,
        depositTag: deposit.tag,
        depositHex: deposit.hex,
      },
      instructions: `Send EXACTLY ${challengeMcm} MCM from wallet ${address.prefixedHex} to ${deposit.tag} within ${this.policy.claimTtlSeconds / 60} minutes.`,
    };
  }
}
