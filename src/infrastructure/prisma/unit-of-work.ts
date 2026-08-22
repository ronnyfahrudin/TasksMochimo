import type { PrismaClient } from "@prisma/client";
import type { Repositories, UnitOfWork } from "@/application/shared/unit-of-work";
import type { PrismaLike } from "./client";
import { PrismaLeaderboardRepository } from "./leaderboard.repository";
import { PrismaRewardsRepository } from "./rewards.repository";
import { PrismaSessionRepository } from "./session.repository";
import { PrismaSubmissionRepository } from "./submission.repository";
import { PrismaTaskRepository } from "./task.repository";
import { PrismaUserRepository } from "./user.repository";
import { PrismaWalletClaimRepository } from "./wallet-claim.repository";

/** Bind every repository to one connection — pooled client or transaction. */
export function buildRepositories(db: PrismaLike, root: PrismaClient): Repositories {
  return {
    users: new PrismaUserRepository(db),
    sessions: new PrismaSessionRepository(db),
    claims: new PrismaWalletClaimRepository(db),
    tasks: new PrismaTaskRepository(db),
    submissions: new PrismaSubmissionRepository(db),
    rewards: new PrismaRewardsRepository(db),
    leaderboard: new PrismaLeaderboardRepository(root),
  };
}

export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(buildRepositories(tx, this.prisma)), {
      // Sign-up does a Mesh-free but multi-write dance; the default 5s timeout
      // is tight once the DB is remote (Neon/Supabase) rather than local.
      timeout: 15_000,
    });
  }
}
