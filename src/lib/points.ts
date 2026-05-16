import { prisma } from "@/lib/prisma";
import { currentPeriod } from "@/lib/utils";

/**
 * Atomically award points to a user, write a ledger row, and bump lifetime.
 * `period` defaults to current UTC YYYY-MM so monthly reset only zeros `points`
 * while `lifetimePoints` keeps growing.
 */
export async function awardPoints(opts: {
  userId: string;
  delta: number;
  reason: string;
  submissionId?: string;
  period?: string;
}) {
  const period = opts.period ?? currentPeriod();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: opts.userId },
      data: {
        points: { increment: opts.delta },
        lifetimePoints: { increment: opts.delta },
      },
      select: { id: true, points: true, lifetimePoints: true },
    });
    await tx.pointsLedger.create({
      data: {
        userId: opts.userId,
        delta: opts.delta,
        reason: opts.reason,
        submissionId: opts.submissionId,
        period,
      },
    });
    return user;
  });
}
