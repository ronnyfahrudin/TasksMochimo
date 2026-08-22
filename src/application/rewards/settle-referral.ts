import { Period } from "@/domain/shared/period";
import { REFERRAL_TASK_SLUG, ReferralPolicy } from "@/domain/rewards/referral-policy";
import { Proof } from "@/domain/tasks/proof";
import { Submission } from "@/domain/tasks/submission";
import type { Repositories } from "@/application/shared/unit-of-work";

/**
 * Pay a referrer, once, when their invitee has proven to be real.
 *
 * Called wherever an invitee's standing can change — after they link a wallet,
 * and after every task award — because "has this invite become real yet?" can
 * only be answered at those moments. Cheap to call and safe to call often: it
 * short-circuits on the invitee's own `referralPaidAt` before touching points.
 */
export class SettleReferral {
  static async execute(
    repos: Repositories,
    params: { inviteeId: string; now: Date },
  ): Promise<{ paid: boolean; reason?: string }> {
    const invitee = await repos.users.findById(params.inviteeId);
    if (!invitee) return { paid: false, reason: "no_referrer" };

    // Cheapest possible exits first — most calls stop here.
    if (!invitee.referredById || invitee.referralPaidAt) {
      return { paid: false, reason: invitee.referralPaidAt ? "already_paid" : "no_referrer" };
    }

    const referrer = await repos.users.findById(invitee.referredById);
    if (!referrer) return { paid: false, reason: "no_referrer" };

    const period = Period.current(params.now);
    const decision = ReferralPolicy.decide({
      invitee: {
        id: invitee.id,
        referredById: invitee.referredById,
        hasWallet: invitee.hasWallet,
        referralPaidAt: invitee.referralPaidAt,
        signupIpHash: invitee.signupIpHash,
        taskPointsEarned: await repos.rewards.taskPointsEarned(invitee.id),
      },
      referrer: {
        id: referrer.id,
        referredById: referrer.referredById,
        signupIpHash: referrer.signupIpHash,
        bannedAt: referrer.bannedAt,
      },
      bonusesPaidThisPeriod: await repos.rewards.referralBonusesPaidIn(referrer.id, period),
    });

    if (!decision.pay) return { paid: false, reason: decision.reason };

    const task = await repos.tasks.findBySlug(REFERRAL_TASK_SLUG);
    if (!task) return { paid: false, reason: "no_referrer" }; // task not seeded

    // Stamp the invitee FIRST. markReferralPaid throws if it is already set, so
    // two concurrent settlements cannot both reach the award below.
    invitee.markReferralPaid(params.now);
    await repos.users.save(invitee);

    const submission = await repos.submissions.create(
      Submission.autoApproved({
        userId: referrer.id,
        task,
        proof: Proof.create({ text: `Referred user ${invitee.id}` }),
      }),
    );

    await repos.rewards.award({
      userId: referrer.id,
      amount: task.points,
      reason: ReferralPolicy.reasonFor(invitee.id),
      submissionId: submission.id,
      period,
    });

    return { paid: true };
  }
}
