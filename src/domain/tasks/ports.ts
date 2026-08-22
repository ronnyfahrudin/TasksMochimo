import type { Submission } from "./submission";
import type { Task, TaskHistory } from "./task";

export interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  findBySlug(slug: string): Promise<Task | null>;
}

export interface SubmissionRepository {
  findById(id: string): Promise<Submission | null>;
  /** What this user has already done on this task, for its limit rules. */
  historyFor(params: { userId: string; taskId: string }): Promise<TaskHistory>;
  /**
   * Whether this proof was already claimed by anyone, in any spelling.
   * FLAGGED counts: a rejected-by-machine tweet must not be recyclable.
   */
  findClaimedProof(params: {
    tweetId: string | null;
    url: string | null;
  }): Promise<{ id: string; userId: string } | null>;
  create(submission: Submission): Promise<Submission>;
  save(submission: Submission): Promise<Submission>;
}
