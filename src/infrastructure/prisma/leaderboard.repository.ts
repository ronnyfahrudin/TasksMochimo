import { Period } from "@/domain/shared/period";
import type { LeaderboardEntry, LeaderboardRepository } from "@/domain/rewards/ports";
import type { PrismaClient } from "@prisma/client";

export class PrismaLeaderboardRepository implements LeaderboardRepository {
  // Takes the root client, not a transaction-scoped one: closing a period
  // opens its own transaction and nested Prisma transactions aren't a thing.
  constructor(private readonly db: PrismaClient) {}

  async currentPeriod(): Promise<{ period: Period; lastResetAt: Date | null }> {
    const state = await this.db.appState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, currentPeriod: Period.current().value },
    });
    return {
      period: Period.fromString(state.currentPeriod),
      lastResetAt: state.lastResetAt,
    };
  }

  async standings(): Promise<LeaderboardEntry[]> {
    const rows = await this.db.user.findMany({
      where: { points: { gt: 0 } },
      // Ties break by who reached the score first.
      orderBy: [{ points: "desc" }, { updatedAt: "asc" }],
      select: { id: true, points: true, twitterHandle: true },
    });
    return rows.map((r) => ({ userId: r.id, points: r.points, twitterHandle: r.twitterHandle }));
  }

  async closePeriod(params: {
    closing: Period;
    opening: Period;
    entries: LeaderboardEntry[];
    now: Date;
  }): Promise<{ snapshotted: number }> {
    await this.db.$transaction(async (tx) => {
      for (const [i, entry] of params.entries.entries()) {
        await tx.leaderboardSnapshot.upsert({
          where: { period_userId: { period: params.closing.value, userId: entry.userId } },
          update: { rank: i + 1, points: entry.points, twitterHandle: entry.twitterHandle },
          create: {
            period: params.closing.value,
            userId: entry.userId,
            rank: i + 1,
            points: entry.points,
            twitterHandle: entry.twitterHandle,
          },
        });
      }

      // lifetimePoints is deliberately untouched — only the monthly race resets.
      await tx.user.updateMany({ where: { points: { gt: 0 } }, data: { points: 0 } });

      await tx.appState.update({
        where: { id: 1 },
        data: { currentPeriod: params.opening.value, lastResetAt: params.now },
      });
    });

    return { snapshotted: params.entries.length };
  }
}
