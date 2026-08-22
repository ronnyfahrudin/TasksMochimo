import type { RandomSource } from "@/domain/shared/ports";

/**
 * A signed-in session. Auth.js owns the cookie; the domain owns how long a
 * session lives and how its token is minted.
 */
export class Session {
  static readonly TTL_DAYS = 30;

  private constructor(
    readonly token: string,
    readonly userId: string,
    readonly expiresAt: Date,
  ) {}

  static issue(userId: string, random: RandomSource, now: Date): Session {
    return new Session(
      random.token(32),
      userId,
      new Date(+now + Session.TTL_DAYS * 24 * 60 * 60 * 1000),
    );
  }

  static rehydrate(token: string, userId: string, expiresAt: Date): Session {
    return new Session(token, userId, expiresAt);
  }

  isExpired(now: Date): boolean {
    return +this.expiresAt <= +now;
  }
}
