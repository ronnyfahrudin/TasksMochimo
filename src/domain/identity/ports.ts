import type { MochimoAddress } from "@/domain/wallet/mochimo-address";
import type { Session } from "./session";
import type { UserAccount } from "./user-account";
import type { PasswordHash, PlainPassword, Username } from "./value-objects";

export interface UserRepository {
  findById(id: string): Promise<UserAccount | null>;
  findByUsername(username: Username): Promise<UserAccount | null>;
  findByReferralCode(code: string): Promise<UserAccount | null>;
  /** Any account already holding this username or wallet — the uniqueness check. */
  findConflicting(params: {
    username?: Username;
    address?: MochimoAddress;
    excludeUserId?: string;
  }): Promise<UserAccount | null>;
  /** How many accounts opened from this origin since `since` — the multi-account signal. */
  countSignupsFromIpSince(ipHash: string, since: Date): Promise<number>;
  create(user: UserAccount): Promise<UserAccount>;
  save(user: UserAccount): Promise<UserAccount>;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
}

/**
 * Password hashing, as a port: the algorithm (scrypt today, argon2 tomorrow)
 * is an infrastructure decision, but "a password must be verified in constant
 * time" is a domain rule the port's contract carries.
 */
export interface PasswordHasher {
  hash(plain: PlainPassword): PasswordHash;
  /** MUST be constant-time, and MUST tolerate a null hash without short-circuiting. */
  verify(plain: string, hash: PasswordHash | null): boolean;
}
