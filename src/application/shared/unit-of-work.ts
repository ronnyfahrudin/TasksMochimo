import type { SessionRepository, UserRepository } from "@/domain/identity/ports";
import type { LeaderboardRepository, RewardsRepository } from "@/domain/rewards/ports";
import type { SubmissionRepository, TaskRepository } from "@/domain/tasks/ports";
import type { WalletClaimRepository } from "@/domain/wallet/ports";

/** Every repository, resolved against one connection (or one transaction). */
export type Repositories = {
  users: UserRepository;
  sessions: SessionRepository;
  claims: WalletClaimRepository;
  tasks: TaskRepository;
  submissions: SubmissionRepository;
  rewards: RewardsRepository;
  leaderboard: LeaderboardRepository;
};

/**
 * A transaction boundary the use cases can ask for without knowing about
 * Prisma. Everything inside `run` commits together or not at all — which is
 * what makes "create the account, open its session, and burn the claim" a
 * single fact rather than three hopeful writes.
 */
export interface UnitOfWork {
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
