import { ConflictError } from "@/domain/shared/errors";
import type { Clock, RandomSource } from "@/domain/shared/ports";
import type { PasswordHasher } from "@/domain/identity/ports";
import { Session } from "@/domain/identity/session";
import { UserAccount } from "@/domain/identity/user-account";
import { PlainPassword, Username } from "@/domain/identity/value-objects";
import type { RegistrationPolicy } from "@/domain/wallet/registration-policy";
import type { UnitOfWork } from "@/application/shared/unit-of-work";

export type RegisterWithWalletInput = {
  claimToken: string;
  username: string;
  password: string;
  confirmPassword: string;
  referralCode?: string;
  /** Salted fingerprint of the sign-up origin; null when it cannot be read. */
  signupIpHash?: string | null;
};

/**
 * Accounts allowed from one origin per day. A household or an office shares an
 * address, so this is set well above honest use and only bites farms.
 */
const MAX_ACCOUNTS_PER_ORIGIN_PER_DAY = 4;

export type RegisterWithWalletOutput = {
  userId: string;
  referralCode: string | null;
  session: Session;
  verifiedTxHash: string | null;
  /** False when free-signup mode issued the claim — nothing was proven. */
  provenByPayment: boolean;
};

/**
 * Turn a verified claim into an account.
 *
 * The wallet comes from the claim, never from the request body: that is the
 * whole reason the payment proves anything. Account, session, and the claim's
 * consumption commit together, so a crash can't leave a spent claim with no
 * account or an account nobody can sign into.
 */
export class RegisterWithWallet {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly policy: RegistrationPolicy,
    private readonly hasher: PasswordHasher,
    private readonly random: RandomSource,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterWithWalletInput): Promise<RegisterWithWalletOutput> {
    const username = Username.create(input.username);
    const password = PlainPassword.create(input.password, input.confirmPassword);
    const now = this.clock.now();

    return this.uow.run(async (repos) => {
      const claim = await repos.claims.findByToken(input.claimToken);
      if (!claim) {
        throw new ConflictError(
          "claim.not_found",
          "Wallet claim not found. Start over.",
          "claimToken",
        );
      }
      // A claim opened while free-signup mode was on carries no proof at all.
      // If the deployment now requires payment, that claim must not still be
      // spendable — otherwise turning the flag off leaves a 15-minute window
      // in which anyone can still register any wallet.
      if (this.policy.requiresPayment && !claim.provenByPayment) {
        throw new ConflictError(
          "claim.unproven",
          "This claim was issued without an on-chain payment. Start over.",
          "claimToken",
        );
      }

      // Throws when the claim is unverified, expired, or already spent.
      claim.consume(now);

      const conflict = await repos.users.findConflicting({
        username,
        address: claim.address,
      });
      if (conflict) {
        const takenWallet = conflict.address?.equals(claim.address) ?? false;
        throw new ConflictError(
          takenWallet ? "wallet.registered" : "username.taken",
          takenWallet
            ? "This wallet is already registered. Sign in instead."
            : "Username already taken.",
          takenWallet ? "claimToken" : "username",
        );
      }

      // One person spinning up accounts from one machine is the cheapest farm
      // there is; the wallet challenge barely slows it and free mode not at all.
      if (input.signupIpHash) {
        const since = new Date(+now - 24 * 60 * 60 * 1000);
        const recent = await repos.users.countSignupsFromIpSince(input.signupIpHash, since);
        if (recent >= MAX_ACCOUNTS_PER_ORIGIN_PER_DAY) {
          throw new ConflictError(
            "signup.origin_limit",
            "Too many accounts have been created from here today. Try again tomorrow.",
          );
        }
      }

      const referrer = input.referralCode
        ? await repos.users.findByReferralCode(input.referralCode)
        : null;

      const user = await repos.users.create(
        UserAccount.register({
          username,
          passwordHash: this.hasher.hash(password),
          address: claim.address,
          referredById: referrer?.id ?? null,
          signupIpHash: input.signupIpHash ?? null,
        }),
      );

      const session = await repos.sessions.create(Session.issue(user.id, this.random, now));
      await repos.claims.save(claim);

      // No referral payout here. Creating an account proves nothing about the
      // invitee — the referrer is paid once this account has actually earned
      // points from tasks (see SettleReferral / ReferralPolicy).

      return {
        userId: user.id,
        referralCode: user.referralCode,
        session,
        verifiedTxHash: claim.verifiedTxHash,
        provenByPayment: claim.provenByPayment,
      };
    });
  }
}
