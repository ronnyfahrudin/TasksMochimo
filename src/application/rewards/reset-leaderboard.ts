import { Period } from "@/domain/shared/period";
import type { Clock } from "@/domain/shared/ports";
import type { LeaderboardRepository } from "@/domain/rewards/ports";

export type ResetLeaderboardOutput = {
  ok: true;
  period: string;
  closedPeriod?: string;
  snapshotted?: number;
  message?: string;
};

/**
 * Close the month.
 *
 * Snapshot the standings, then zero live balances while lifetime points stay
 * untouched. Idempotent by design — a cron that fires twice, or a manual run
 * after an automatic one, must not wipe a period that was already closed.
 */
export class ResetLeaderboard {
  constructor(
    private readonly leaderboard: LeaderboardRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<ResetLeaderboardOutput> {
    const now = this.clock.now();
    const opening = Period.current(now);
    const closing = Period.previous(now);

    const state = await this.leaderboard.currentPeriod();
    if (state.period.equals(opening) && state.lastResetAt) {
      return { ok: true, period: opening.value, message: "Already reset for this period" };
    }

    const entries = await this.leaderboard.standings();
    const { snapshotted } = await this.leaderboard.closePeriod({
      closing,
      opening,
      entries,
      now,
    });

    return {
      ok: true,
      period: opening.value,
      closedPeriod: closing.value,
      snapshotted,
    };
  }
}
