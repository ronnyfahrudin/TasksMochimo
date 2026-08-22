import { NotFoundError } from "@/domain/shared/errors";
import { Period } from "@/domain/shared/period";
import type { Clock } from "@/domain/shared/ports";
import { SettleReferral } from "@/application/rewards/settle-referral";
import type { UnitOfWork } from "@/application/shared/unit-of-work";

/**
 * A moderator settles a queued submission.
 *
 * The aggregate refuses a second approval, so a double-click (or two
 * moderators on the same row) can't pay the same points twice.
 */
export class ReviewSubmission {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    reviewerId: string;
    submissionId: string;
    action: "approve" | "reject";
    reason?: string;
  }): Promise<{ status: string }> {
    const now = this.clock.now();

    return this.uow.run(async (repos) => {
      const reviewer = await repos.users.findById(input.reviewerId);
      if (!reviewer) throw new NotFoundError("user.not_found", "Account not found");
      reviewer.assertCanModerate();

      const submission = await repos.submissions.findById(input.submissionId);
      if (!submission) throw new NotFoundError("submission.not_found", "Not found");

      const task = await repos.tasks.findById(submission.taskId);
      if (!task) throw new NotFoundError("task.not_found", "Task not found");

      if (input.action === "reject") {
        submission.reject({ reviewerId: reviewer.id, reason: input.reason, now });
        await repos.submissions.save(submission);
        return { status: submission.status };
      }

      submission.approve({ task, reviewerId: reviewer.id, now });
      await repos.submissions.save(submission);
      await repos.rewards.award({
        userId: submission.userId,
        amount: submission.pointsAwarded,
        reason: `task:${task.slug}`,
        submissionId: submission.id,
        period: Period.current(now),
      });

      // An approval can be what tips an invitee over the referral threshold.
      await SettleReferral.execute(repos, { inviteeId: submission.userId, now });

      return { status: submission.status };
    });
  }
}
