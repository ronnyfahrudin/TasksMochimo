import { NotFoundError } from "@/domain/shared/errors";
import type { Clock } from "@/domain/shared/ports";
import type { MeshGateway, WalletClaimRepository } from "@/domain/wallet/ports";
import type { RegistrationPolicy } from "@/domain/wallet/registration-policy";

export type PollWalletClaimOutput =
  | { status: "verified"; verifiedTxHash: string | null; confirmed?: boolean; hex: string; tag: string; remainingSeconds: number }
  | { status: "consumed"; message: string }
  | { status: "expired" }
  | { status: "pending"; remainingSeconds: number; nextCheckIn?: number };

/**
 * Ask whether the challenge payment has landed yet.
 *
 * The throttle slot is taken *before* the Mesh lookup, not after: the lookup
 * takes seconds, and polls arriving mid-flight would otherwise all sail past
 * the check and pile onto a public node we don't own.
 */
export class PollWalletClaim {
  constructor(
    private readonly claims: WalletClaimRepository,
    private readonly mesh: MeshGateway,
    private readonly policy: RegistrationPolicy,
    private readonly clock: Clock,
  ) {}

  async execute(input: { claimToken: string }): Promise<PollWalletClaimOutput> {
    const claim = await this.claims.findByToken(input.claimToken);
    if (!claim) {
      throw new NotFoundError("claim.not_found", "Claim missing. Start over.");
    }

    const now = this.clock.now();

    if (claim.isConsumed) {
      return { status: "consumed", message: "Claim already used to create an account." };
    }
    if (claim.isVerified) {
      return {
        status: "verified",
        verifiedTxHash: claim.verifiedTxHash,
        hex: claim.address.hex,
        tag: claim.address.tag,
        remainingSeconds: claim.remainingSeconds(now),
      };
    }
    if (claim.isExpired(now)) {
      return { status: "expired" };
    }

    const waitSeconds = claim.throttledFor(now, this.policy.minCheckIntervalMs);
    if (waitSeconds > 0) {
      return {
        status: "pending",
        remainingSeconds: claim.remainingSeconds(now),
        nextCheckIn: waitSeconds,
      };
    }

    claim.markChecked(now);
    await this.claims.save(claim);

    const payment = await this.mesh.findChallengePayment({
      from: claim.address,
      toHex: this.policy.depositAddress().hex,
      nanoMcm: claim.challenge.nanoMcm,
      notBefore: claim.startedAt,
    });

    if (!payment) {
      return { status: "pending", remainingSeconds: claim.remainingSeconds(now) };
    }

    // Deliberately the `now` from the top of this call, not a fresh one: the
    // Mesh lookup takes seconds, and a claim that was live when we started
    // looking must not lose a payment the user already made because the window
    // closed mid-request. Their MCM is spent either way.
    claim.markVerified(payment.hash, now);
    await this.claims.save(claim);

    return {
      status: "verified",
      verifiedTxHash: payment.hash,
      confirmed: payment.confirmed,
      hex: claim.address.hex,
      tag: claim.address.tag,
      remainingSeconds: claim.remainingSeconds(now),
    };
  }
}
