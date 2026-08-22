import { ConflictError } from "@/domain/shared/errors";
import { Points } from "@/domain/rewards/points";
import { ModerationPolicy, ModerationVerdict } from "./moderation";
import { Proof } from "./proof";
import type { Task } from "./task";

export type SubmissionStatus =
  | "PENDING"
  | "APPROVED"
  | "AUTO_APPROVED"
  | "REJECTED"
  | "FLAGGED";

export type SubmissionSnapshot = {
  id: string | null;
  userId: string;
  taskId: string;
  proofUrl: string | null;
  proofText: string | null;
  status: SubmissionStatus;
  pointsAwarded: number;
  aiScore: number | null;
  aiVerdict: string | null;
  aiReason: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  rejectReason: string | null;
  createdAt: Date | null;
};

/**
 * Aggregate root for one attempt at a task.
 *
 * It owns its own status machine: a submission decides what it becomes when a
 * verdict arrives, and refuses a second approval no matter which route asks.
 * Points are *reported* here (`pointsAwarded`) and *credited* by the rewards
 * context — one aggregate, one transaction boundary.
 */
export class Submission {
  private constructor(
    private _id: string | null,
    readonly userId: string,
    readonly taskId: string,
    readonly proof: Proof,
    private _status: SubmissionStatus,
    private _pointsAwarded: Points,
    private _verdict: ModerationVerdict | null,
    private _reviewedById: string | null,
    private _reviewedAt: Date | null,
    private _rejectReason: string | null,
    readonly createdAt: Date | null,
  ) {}

  /** Open a submission whose task grants approval on sight. */
  static autoApproved(params: { userId: string; task: Task; proof: Proof }): Submission {
    return new Submission(
      null,
      params.userId,
      params.task.id,
      params.proof,
      "AUTO_APPROVED",
      params.task.points,
      null,
      null,
      null,
      null,
      null,
    );
  }

  /** Open a submission that a moderator — machine or human — must judge. */
  static moderated(params: {
    userId: string;
    task: Task;
    proof: Proof;
    verdict: ModerationVerdict | null;
  }): Submission {
    const status = ModerationPolicy.decide(params.verdict);
    return new Submission(
      null,
      params.userId,
      params.task.id,
      params.proof,
      status,
      status === "AUTO_APPROVED" ? params.task.points : Points.zero(),
      params.verdict,
      null,
      null,
      null,
      null,
    );
  }

  static rehydrate(s: SubmissionSnapshot): Submission {
    return new Submission(
      s.id,
      s.userId,
      s.taskId,
      Proof.rehydrate(s.proofUrl, s.proofText),
      s.status,
      Points.of(s.pointsAwarded),
      s.aiVerdict
        ? new ModerationVerdict(
            s.aiVerdict as ModerationVerdict["verdict"],
            s.aiScore ?? 0,
            s.aiReason ?? "",
          )
        : null,
      s.reviewedById,
      s.reviewedAt,
      s.rejectReason,
      s.createdAt,
    );
  }

  get id(): string {
    if (!this._id) throw new Error("Submission has not been persisted yet");
    return this._id;
  }

  get status(): SubmissionStatus {
    return this._status;
  }

  get pointsAwarded(): Points {
    return this._pointsAwarded;
  }

  get verdict(): ModerationVerdict | null {
    return this._verdict;
  }

  get isApproved(): boolean {
    return this._status === "APPROVED" || this._status === "AUTO_APPROVED";
  }

  /** Whether this submission still owes its author a points credit. */
  get awardsPoints(): boolean {
    return this.isApproved && !this._pointsAwarded.isZero;
  }

  /** Human approval. Points come from the task, never from the request body. */
  approve(params: { task: Task; reviewerId: string; now: Date }): void {
    this.assertNotSettled();
    this._status = "APPROVED";
    this._pointsAwarded = params.task.points;
    this._reviewedById = params.reviewerId;
    this._reviewedAt = params.now;
    this._rejectReason = null;
  }

  reject(params: { reviewerId: string; reason?: string | null; now: Date }): void {
    this.assertNotSettled();
    this._status = "REJECTED";
    this._reviewedById = params.reviewerId;
    this._reviewedAt = params.now;
    this._rejectReason = params.reason ?? null;
  }

  private assertNotSettled(): void {
    if (this.isApproved) {
      throw new ConflictError("submission.already_approved", "Already approved");
    }
  }

  assignId(id: string): void {
    this._id = id;
  }

  toSnapshot(): SubmissionSnapshot {
    return {
      id: this._id,
      userId: this.userId,
      taskId: this.taskId,
      proofUrl: this.proof.url,
      proofText: this.proof.text,
      status: this._status,
      pointsAwarded: this._pointsAwarded.value,
      aiScore: this._verdict?.score ?? null,
      aiVerdict: this._verdict?.verdict ?? null,
      aiReason: this._verdict?.reason ?? null,
      reviewedById: this._reviewedById,
      reviewedAt: this._reviewedAt,
      rejectReason: this._rejectReason,
      createdAt: this.createdAt,
    };
  }
}
