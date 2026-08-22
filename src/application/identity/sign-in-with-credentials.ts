import { ForbiddenError, UnauthenticatedError } from "@/domain/shared/errors";
import type { Clock, RandomSource } from "@/domain/shared/ports";
import type { PasswordHasher, SessionRepository, UserRepository } from "@/domain/identity/ports";
import { Session } from "@/domain/identity/session";
import { Username } from "@/domain/identity/value-objects";

/**
 * Username + password sign-in.
 *
 * The password is verified even when no such user exists (the hasher's
 * contract requires it), so response time can't be used to enumerate accounts.
 * The failure message is identical for "no such user" and "wrong password" for
 * the same reason.
 */
export class SignInWithCredentials {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly random: RandomSource,
    private readonly clock: Clock,
  ) {}

  async execute(input: { username: string; password: string }): Promise<{ session: Session }> {
    // Not Username.create(): a malformed username is a failed login, not a
    // validation error that tells the caller their guess was the wrong shape.
    const parsed = Username.schema.safeParse(input.username);
    const user = parsed.success
      ? await this.users.findByUsername(Username.rehydrate(parsed.data))
      : null;

    const ok = this.hasher.verify(input.password, user?.passwordHash ?? null);
    if (!user || !ok) {
      throw new UnauthenticatedError("Invalid username or password");
    }
    if (user.isBanned) {
      throw new ForbiddenError("Account suspended");
    }

    const session = await this.sessions.create(
      Session.issue(user.id, this.random, this.clock.now()),
    );
    return { session };
  }
}
