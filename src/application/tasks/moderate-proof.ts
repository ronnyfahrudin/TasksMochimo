import { NotFoundError } from "@/domain/shared/errors";
import type { ContentModerator, ModerationVerdict } from "@/domain/tasks/moderation";
import { Proof } from "@/domain/tasks/proof";
import type { UserRepository } from "@/domain/identity/ports";

/**
 * Re-run the AI moderator on demand from the review queue. Read-only: it
 * returns a verdict for a human to act on, it never changes a submission.
 */
export class ModerateProof {
  constructor(
    private readonly users: UserRepository,
    private readonly moderator: ContentModerator,
  ) {}

  async execute(input: {
    requestedById: string;
    taskTitle: string;
    taskDescription: string;
    proofUrl?: string | null;
    proofText?: string | null;
  }): Promise<ModerationVerdict> {
    const user = await this.users.findById(input.requestedById);
    if (!user) throw new NotFoundError("user.not_found", "Account not found");
    user.assertCanModerate();

    return this.moderator.review({
      taskTitle: input.taskTitle,
      taskDescription: input.taskDescription,
      proof: Proof.create({ url: input.proofUrl, text: input.proofText }),
    });
  }
}
