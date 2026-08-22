import { ConflictError, TooSoonError, ValidationError } from "@/domain/shared/errors";
import { Points } from "@/domain/rewards/points";
import type { Proof } from "./proof";

export type TaskCategory = "SOCIAL" | "CONTENT" | "REFERRAL" | "DAILY";
export type ProofType = "TWEET_URL" | "YOUTUBE_URL" | "MEDIUM_URL" | "TEXT" | "AUTO" | "NONE";

const URL_PATTERNS: Partial<Record<ProofType, RegExp>> = {
  TWEET_URL: /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i,
  YOUTUBE_URL:
    /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+|youtube\.com\/shorts\/[\w-]+)/i,
  MEDIUM_URL:
    /^https?:\/\/(?:[\w-]+\.)?medium\.com\/[^\s]+|^https?:\/\/[\w-]+\.medium\.com\/[^\s]+/i,
};

/** What a user has already done on one task — the input to its limit rules. */
export type TaskHistory = {
  /** Completions that counted (APPROVED or AUTO_APPROVED), newest first. */
  completedAt: Date[];
};

/**
 * A quest on the board.
 *
 * An entity, not a row: it decides whether a given proof satisfies it, and
 * whether this user may attempt it again yet. Those rules were previously
 * inlined in the submit route, which is why the daily-cooldown and max-per-user
 * checks could only ever run there.
 */
export class Task {
  private constructor(
    readonly id: string,
    readonly slug: string,
    readonly title: string,
    readonly description: string,
    readonly category: TaskCategory,
    readonly proofType: ProofType,
    readonly points: Points,
    readonly maxPerUser: number | null,
    readonly cooldownHrs: number | null,
    readonly autoApprove: boolean,
    readonly active: boolean,
  ) {}

  static rehydrate(row: {
    id: string;
    slug: string;
    title: string;
    description: string;
    category: TaskCategory;
    proofType: ProofType;
    points: number;
    maxPerUser: number | null;
    cooldownHrs: number | null;
    autoApprove: boolean;
    active: boolean;
  }): Task {
    return new Task(
      row.id,
      row.slug,
      row.title,
      row.description,
      row.category,
      row.proofType,
      Points.of(row.points),
      row.maxPerUser,
      row.cooldownHrs,
      row.autoApprove,
      row.active,
    );
  }

  /** Faucet payouts need somewhere to pay; daily check-ins don't. */
  get requiresWallet(): boolean {
    return this.category !== "DAILY";
  }

  /**
   * Tasks the SYSTEM credits, never the user.
   *
   * "Refer a friend" is a REFERRAL task with AUTO proof and no per-user cap —
   * which meant anyone could submit it by hand, over and over, for its full
   * points without ever inviting anybody. It exists only as the container the
   * referral credit is written against, so direct submission is refused.
   */
  get isSystemGranted(): boolean {
    return this.category === "REFERRAL" && (this.proofType === "AUTO" || this.proofType === "NONE");
  }

  /** Tasks whose completion is self-evident skip moderation entirely. */
  get grantsImmediateApproval(): boolean {
    return this.proofType === "AUTO" || this.proofType === "NONE" || this.autoApprove;
  }

  get isModeratable(): boolean {
    return !this.grantsImmediateApproval;
  }

  /** The proof must be the shape this task asked for. */
  validateProof(proof: Proof): void {
    const pattern = URL_PATTERNS[this.proofType];
    if (pattern) {
      if (!proof.url) {
        throw new ValidationError("proof.url.required", "Proof URL required.", "proofUrl");
      }
      if (!pattern.test(proof.url)) {
        throw new ValidationError(
          "proof.url.invalid",
          `Invalid ${this.proofType.replace("_URL", "")} URL.`,
          "proofUrl",
        );
      }
    }
    if (this.proofType === "TEXT" && !proof.text) {
      throw new ValidationError("proof.text.required", "Proof text required.", "proofText");
    }
  }

  /** Per-user completion cap and cooldown — the anti-farming rules. */
  assertAvailableFor(history: TaskHistory, now: Date): void {
    const completions = history.completedAt.length;
    if (this.maxPerUser != null && completions >= this.maxPerUser) {
      throw new ConflictError(
        "task.max_reached",
        "You've reached the max completions for this task.",
      );
    }
    if (this.cooldownHrs && completions > 0) {
      const last = Math.max(...history.completedAt.map((d) => +d));
      const cooldownMs = this.cooldownHrs * 3600 * 1000;
      const elapsed = +now - last;
      if (elapsed < cooldownMs) {
        throw new TooSoonError(
          "task.cooldown",
          "Task is on cooldown.",
          Math.ceil((cooldownMs - elapsed) / 1000),
        );
      }
    }
  }

  assertOpen(): void {
    if (!this.active) {
      throw new ValidationError("task.inactive", "Task not found");
    }
  }
}
