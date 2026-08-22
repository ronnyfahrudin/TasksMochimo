import { ConflictError, NotFoundError, ValidationError } from "@/domain/shared/errors";
import type { Clock } from "@/domain/shared/ports";
import { Period } from "@/domain/shared/period";
import type { ContentModerator } from "@/domain/tasks/moderation";
import { Proof } from "@/domain/tasks/proof";
import { Submission } from "@/domain/tasks/submission";
import { SettleReferral } from "@/application/rewards/settle-referral";
import type { Repositories, UnitOfWork } from "@/application/shared/unit-of-work";

export type SubmitTaskProofOutput = {
  status: string;
  pointsAwarded: number;
  ai: { verdict: string; score: number; reason: string } | null;
};

/**
 * Submit evidence for a task.
 *
 * Order matters and is deliberate: cheap local rules first (banned, wallet,
 * proof shape, limits, duplicates), and only then the slow, paid AI call —
 * so an abusive or duplicate submission never costs a moderation request.
 */
export class SubmitTaskProof {
  constructor(
    private readonly uow: UnitOfWork,
    /** Non-transactional repositories for the read-only checks. */
    private readonly repos: Repositories,
    private readonly moderator: ContentModerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: string;
    taskId: string;
    proofUrl?: string | null;
    proofText?: string | null;
  }): Promise<SubmitTaskProofOutput> {
    const now = this.clock.now();
    const proof = Proof.create({ url: input.proofUrl, text: input.proofText });

    // Phase 1 — everything that can reject the submission without paying for
    // moderation. Read-only, so it deliberately does NOT open a transaction:
    // holding an interactive Prisma transaction open across these reads (and
    // previously across nothing else) just burns a pooled connection.
    const { task } = await (async () => {
      const repos = this.repos;
      const user = await repos.users.findById(input.userId);
      if (!user) throw new NotFoundError("user.not_found", "Account not found");
      user.assertActive();

      const task = await repos.tasks.findById(input.taskId);
      if (!task) throw new NotFoundError("task.not_found", "Task not found");
      task.assertOpen();

      if (task.isSystemGranted) {
        throw new ValidationError(
          "task.system_granted",
          "This one is credited automatically when an invite of yours qualifies — there is nothing to submit.",
        );
      }

      if (task.requiresWallet && !user.hasWallet) {
        throw new ValidationError("wallet.required", "Add your Mochimo wallet address first.");
      }

      task.validateProof(proof);
      task.assertAvailableFor(
        await repos.submissions.historyFor({ userId: user.id, taskId: task.id }),
        now,
      );

      if (proof.url) {
        const claimed = await repos.submissions.findClaimedProof({
          tweetId: proof.tweetId?.value ?? null,
          url: proof.url,
        });
        if (claimed) {
          throw new ConflictError(
            "proof.duplicate",
            claimed.userId === user.id
              ? "You already submitted this tweet."
              : "This tweet was already claimed by another user.",
          );
        }
      }

      return { task };
    })();

    // Phase 2 — tasks that approve on sight never reach the moderator.
    if (task.grantsImmediateApproval) {
      return this.persist(input.userId, task.id, () =>
        Submission.autoApproved({ userId: input.userId, task, proof }),
      );
    }

    // Best-effort: a moderator outage leaves the submission PENDING for a
    // human rather than failing the user's request.
    const verdict = await this.moderator
      .review({ taskTitle: task.title, taskDescription: task.description, proof })
      .catch(() => null);

    return this.persist(input.userId, task.id, () =>
      Submission.moderated({ userId: input.userId, task, proof, verdict }),
    );
  }

  /** Phase 3 — write the submission and its points credit in one transaction. */
  private async persist(
    userId: string,
    taskId: string,
    build: () => Submission,
  ): Promise<SubmitTaskProofOutput> {
    const now = this.clock.now();
    return this.uow.run(async (repos) => {
      const task = await repos.tasks.findById(taskId);
      if (!task) throw new NotFoundError("task.not_found", "Task not found");

      const submission = await repos.submissions.create(build());

      if (submission.awardsPoints) {
        await repos.rewards.award({
          userId,
          amount: submission.pointsAwarded,
          reason: `task:${task.slug}`,
          submissionId: submission.id,
          period: Period.current(now),
        });
      }

      // Points just moved, so the invitee may have crossed the referral
      // threshold. Same transaction: the credit and its consequence commit together.
      if (submission.awardsPoints) {
        await SettleReferral.execute(repos, { inviteeId: userId, now });
      }

      const v = submission.verdict;
      return {
        status: submission.status,
        pointsAwarded: submission.pointsAwarded.value,
        ai: v ? { verdict: v.verdict, score: v.score, reason: v.reason } : null,
      };
    });
  }
}
