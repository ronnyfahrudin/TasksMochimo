import { Submission } from "@/domain/tasks/submission";
import type { SubmissionRepository } from "@/domain/tasks/ports";
import type { TaskHistory } from "@/domain/tasks/task";
import type { PrismaLike } from "./client";

/**
 * Statuses that occupy a proof. FLAGGED is included on purpose: a tweet the
 * moderator disliked must not become reusable by editing the URL.
 */
const CLAIMING_STATUSES = ["APPROVED", "AUTO_APPROVED", "PENDING", "FLAGGED"] as const;
const COMPLETED_STATUSES = ["APPROVED", "AUTO_APPROVED"] as const;

export class PrismaSubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: PrismaLike) {}

  async findById(id: string): Promise<Submission | null> {
    const row = await this.db.submission.findUnique({ where: { id } });
    return row ? Submission.rehydrate(row) : null;
  }

  async historyFor(params: { userId: string; taskId: string }): Promise<TaskHistory> {
    const rows = await this.db.submission.findMany({
      where: {
        userId: params.userId,
        taskId: params.taskId,
        status: { in: [...COMPLETED_STATUSES] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    return { completedAt: rows.map((r) => r.createdAt) };
  }

  async findClaimedProof(params: {
    tweetId: string | null;
    url: string | null;
  }): Promise<{ id: string; userId: string } | null> {
    if (!params.tweetId && !params.url) return null;
    // Match by tweet ID where we have one — resistant to x.com/twitter.com,
    // tracking params and /photo suffixes. Other URL types compare exactly.
    const where = params.tweetId
      ? { proofUrl: { contains: `/status/${params.tweetId}` } }
      : { proofUrl: params.url };

    return this.db.submission.findFirst({
      where: { ...where, status: { in: [...CLAIMING_STATUSES] } },
      select: { id: true, userId: true },
    });
  }

  async create(submission: Submission): Promise<Submission> {
    const s = submission.toSnapshot();
    const row = await this.db.submission.create({
      data: {
        userId: s.userId,
        taskId: s.taskId,
        proofUrl: s.proofUrl,
        proofText: s.proofText,
        status: s.status,
        pointsAwarded: s.pointsAwarded,
        aiScore: s.aiScore,
        aiVerdict: s.aiVerdict,
        aiReason: s.aiReason,
      },
    });
    return Submission.rehydrate(row);
  }

  async save(submission: Submission): Promise<Submission> {
    const s = submission.toSnapshot();
    const row = await this.db.submission.update({
      where: { id: submission.id },
      data: {
        status: s.status,
        pointsAwarded: s.pointsAwarded,
        reviewedById: s.reviewedById,
        reviewedAt: s.reviewedAt,
        rejectReason: s.rejectReason,
      },
    });
    return Submission.rehydrate(row);
  }
}
