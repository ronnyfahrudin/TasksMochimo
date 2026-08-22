import { ConflictError, NotFoundError } from "@/domain/shared/errors";
import type { UserRepository } from "@/domain/identity/ports";

/**
 * Record who invited this account.
 *
 * Attribution only — no points change hands here. The bonus is settled when
 * the invitee first links a wallet (see ReferralPolicy), because an account
 * with nowhere to receive MCM isn't a referral worth paying for.
 */
export class LinkReferrer {
  constructor(private readonly users: UserRepository) {}

  async execute(input: {
    userId: string;
    code: string;
  }): Promise<{ linked: boolean; alreadyLinked?: boolean }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundError("user.not_found", "Account not found");

    if (user.referredById) return { linked: false, alreadyLinked: true };
    if (user.referralCode === input.code) {
      throw new ConflictError("referral.self", "Cannot refer yourself");
    }

    const referrer = await this.users.findByReferralCode(input.code);
    if (!referrer) {
      throw new NotFoundError("referral.invalid", "Invalid referral code");
    }

    user.attributeTo(referrer.id);
    await this.users.save(user);
    return { linked: true };
  }
}
