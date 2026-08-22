import type { Period } from "@/domain/shared/period";
import type { Points } from "./points";

export type PointsAward = {
  userId: string;
  amount: Points;
  /** Provenance, e.g. "task:daily-checkin" or "referral:<userId>". */
  reason: string;
  submissionId?: string;
  period: Period;
};

export interface RewardsRepository {
  /**
   * Points this user earned from TASKS. Referral credits are excluded on
   * purpose: a referral chain must never qualify itself.
   */
  taskPointsEarned(userId: string): Promise<number>;

  /** Referral bonuses already paid to this referrer in the given period. */
  referralBonusesPaidIn(referrerId: string, period: Period): Promise<number>;

  /**
   * Credit points and write the ledger row atomically. Both halves or neither —
   * a balance the ledger can't explain is a support ticket nobody can answer.
   */
  award(award: PointsAward): Promise<{ points: number; lifetimePoints: number }>;
}

export type LeaderboardEntry = {
  userId: string;
  points: number;
  twitterHandle: string | null;
};

export interface LeaderboardRepository {
  /** Everyone with a positive balance, ranked, for the period being closed. */
  standings(): Promise<LeaderboardEntry[]>;
  /** Snapshot the period and zero live balances — atomically, or not at all. */
  closePeriod(params: {
    closing: Period;
    opening: Period;
    entries: LeaderboardEntry[];
    now: Date;
  }): Promise<{ snapshotted: number }>;
  /** The period the app currently considers open. */
  currentPeriod(): Promise<{ period: Period; lastResetAt: Date | null }>;
}
