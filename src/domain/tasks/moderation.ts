import type { Proof } from "./proof";

export type Verdict = "approve" | "reject" | "review";

/** What the AI moderator concluded about one submission. */
export class ModerationVerdict {
  constructor(
    readonly verdict: Verdict,
    /** Confidence in [0,1] that the proof is valid and on-topic. */
    readonly score: number,
    readonly reason: string,
  ) {}

  static needsHuman(reason: string): ModerationVerdict {
    return new ModerationVerdict("review", 0.5, reason);
  }
}

/**
 * How much the house trusts the machine.
 *
 * Deliberately conservative in both directions: an approval needs high
 * confidence, and anything the model dislikes is flagged for a human rather
 * than rejected outright, because the moderator is a heuristic and points are
 * money here.
 */
export class ModerationPolicy {
  static readonly AUTO_APPROVE_AT = 0.85;
  static readonly FLAG_AT = 0.2;

  static decide(verdict: ModerationVerdict | null): "AUTO_APPROVED" | "FLAGGED" | "PENDING" {
    if (!verdict) return "PENDING"; // moderator unreachable — a human decides
    if (verdict.verdict === "approve" && verdict.score >= ModerationPolicy.AUTO_APPROVE_AT) {
      return "AUTO_APPROVED";
    }
    if (verdict.verdict === "reject" || verdict.score <= ModerationPolicy.FLAG_AT) {
      return "FLAGGED";
    }
    return "PENDING";
  }
}

/**
 * Port: an automated content moderator.
 *
 * Takes the task's description rather than the Task entity so an admin can
 * also re-moderate an arbitrary title/proof pair from the review queue.
 */
export interface ContentModerator {
  review(input: {
    taskTitle: string;
    taskDescription: string;
    proof: Proof;
  }): Promise<ModerationVerdict>;
}
