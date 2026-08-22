import type { SessionRepository } from "@/domain/identity/ports";
import { Session } from "@/domain/identity/session";
import type { PrismaLike } from "./client";

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: PrismaLike) {}

  async create(session: Session): Promise<Session> {
    const row = await this.db.session.create({
      data: {
        sessionToken: session.token,
        userId: session.userId,
        expires: session.expiresAt,
      },
    });
    return Session.rehydrate(row.sessionToken, row.userId, row.expires);
  }
}
