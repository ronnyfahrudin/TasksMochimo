import type { Period } from "@/domain/shared/period";
import type { PointsAward, RewardsRepository } from "@/domain/rewards/ports";
import type { PrismaLike } from "./client";

export class PrismaRewardsRepository implements RewardsRepository {
  constructor(private readonly db: PrismaLike) {}

  /** Ledger rows tagged `referral:` are excluded so referrals cannot qualify each other. */
  async taskPointsEarned(userId: string): Promise<number> {
    const rows = await this.db.pointsLedger.findMany({
      where: { userId, NOT: { reason: { startsWith: "referral:" } } },
      select: { delta: true },
    });
    return rows.reduce((sum, r) => sum + r.delta, 0);
  }

  async referralBonusesPaidIn(referrerId: string, period: Period): Promise<number> {
    return this.db.pointsLedger.count({
      where: { userId: referrerId, period: period.value, reason: { startsWith: "referral:" } },
    });
  }

  /**
   * Balance and ledger move together. Callers inside a unit of work get the
   * surrounding transaction; a caller outside one still gets these two writes
   * atomically, because a balance the ledger can't explain is unauditable.
   */
  async award(award: PointsAward): Promise<{ points: number; lifetimePoints: number }> {
    const user = await this.db.user.update({
      where: { id: award.userId },
      data: {
        points: { increment: award.amount.value },
        lifetimePoints: { increment: award.amount.value },
      },
      select: { points: true, lifetimePoints: true },
    });

    await this.db.pointsLedger.create({
      data: {
        userId: award.userId,
        delta: award.amount.value,
        reason: award.reason,
        submissionId: award.submissionId,
        period: award.period.value,
      },
    });

    return user;
  }
}
