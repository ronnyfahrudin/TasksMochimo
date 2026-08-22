/**
 * When a referral is worth points — and when it is farming.
 *
 * The old rule paid 100 points the moment an invitee linked a wallet. Proving
 * a wallet costs ~0.001 MCM (nothing at all in free-signup mode), so the whole
 * scheme was: make a wallet, register, collect. The referrer never had to
 * bring a real contributor.
 *
 * So attribution and PAYMENT are now separate moments. An invitee is credited
 * to their referrer immediately; the referrer is paid only once that invitee
 * has done real work of their own. Everything below exists to make farming
 * cost more than it pays.
 */
export const REFERRAL_TASK_SLUG = "refer-friend";

export type ReferralContext = {
  invitee: {
    id: string;
    referredById: string | null;
    hasWallet: boolean;
    /** Set once the referrer has been paid for this account. */
    referralPaidAt: Date | null;
    signupIpHash: string | null;
    /** Points earned from TASKS — referral credits excluded. */
    taskPointsEarned: number;
  };
  referrer: {
    id: string;
    referredById: string | null;
    signupIpHash: string | null;
    bannedAt: Date | null;
  };
  /** Referral bonuses this referrer has already been paid this period. */
  bonusesPaidThisPeriod: number;
};

export type ReferralDecision =
  | { pay: true; referrerId: string }
  | { pay: false; reason: ReferralRefusal };

export type ReferralRefusal =
  | "no_referrer"
  | "already_paid"
  | "no_wallet"
  | "not_qualified_yet"
  | "self_referral"
  | "circular"
  | "same_origin"
  | "referrer_banned"
  | "period_cap";

export class ReferralPolicy {
  /**
   * Work an invitee must do before their referrer is paid. Set at the value of
   * two mid-tier social tasks: enough that a throwaway account is not free to
   * create, low enough that a genuine invite clears it on their first session.
   */
  static readonly QUALIFYING_POINTS = 100;

  /**
   * Ceiling per referrer per month. A real community builder never approaches
   * this; a farm hits it immediately, which is the point.
   */
  static readonly MAX_PAID_PER_PERIOD = 25;

  static decide(ctx: ReferralContext): ReferralDecision {
    const { invitee, referrer } = ctx;

    if (!invitee.referredById) return { pay: false, reason: "no_referrer" };
    if (invitee.referralPaidAt) return { pay: false, reason: "already_paid" };

    // Payouts go to a wallet; an invitee without one cannot be a real user yet.
    if (!invitee.hasWallet) return { pay: false, reason: "no_wallet" };

    if (invitee.taskPointsEarned < ReferralPolicy.QUALIFYING_POINTS) {
      return { pay: false, reason: "not_qualified_yet" };
    }

    if (referrer.id === invitee.id) return { pay: false, reason: "self_referral" };

    // A pair inviting each other is two accounts and one person, twice over.
    if (referrer.referredById === invitee.id) return { pay: false, reason: "circular" };

    // Both accounts opened from the same place is the clearest farming signal
    // we can see without asking users for anything extra.
    if (
      referrer.signupIpHash &&
      invitee.signupIpHash &&
      referrer.signupIpHash === invitee.signupIpHash
    ) {
      return { pay: false, reason: "same_origin" };
    }

    if (referrer.bannedAt) return { pay: false, reason: "referrer_banned" };

    if (ctx.bonusesPaidThisPeriod >= ReferralPolicy.MAX_PAID_PER_PERIOD) {
      return { pay: false, reason: "period_cap" };
    }

    return { pay: true, referrerId: referrer.id };
  }

  /** Provenance written to the ledger, so every credit is traceable. */
  static reasonFor(referredUserId: string): string {
    return `referral:${referredUserId}`;
  }

  /** What a referrer sees for an invite that has not qualified yet. */
  static explain(reason: ReferralRefusal): string {
    switch (reason) {
      case "not_qualified_yet":
        return `Invite has not earned ${ReferralPolicy.QUALIFYING_POINTS} points from tasks yet.`;
      case "no_wallet":
        return "Invite has not proven a wallet yet.";
      case "period_cap":
        return `Referral cap of ${ReferralPolicy.MAX_PAID_PER_PERIOD} reached for this month.`;
      case "same_origin":
      case "circular":
      case "self_referral":
        return "This invite does not qualify for a referral bonus.";
      default:
        return "No referral bonus is due.";
    }
  }
}
