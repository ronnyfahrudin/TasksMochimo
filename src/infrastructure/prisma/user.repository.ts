import type { UserRepository } from "@/domain/identity/ports";
import { UserAccount, type UserAccountSnapshot } from "@/domain/identity/user-account";
import type { Username } from "@/domain/identity/value-objects";
import type { MochimoAddress } from "@/domain/wallet/mochimo-address";
import type { PrismaLike } from "./client";

const SELECT = {
  id: true,
  username: true,
  passwordHash: true,
  role: true,
  mochimoAddress: true,
  mochimoTag: true,
  referralCode: true,
  referredById: true,
  twitterHandle: true,
  bannedAt: true,
  referralPaidAt: true,
  signupIpHash: true,
} as const;

type Row = { [K in keyof typeof SELECT]: unknown } & UserAccountSnapshot;

function toDomain(row: Row | null): UserAccount | null {
  return row ? UserAccount.rehydrate(row) : null;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaLike) {}

  async findById(id: string): Promise<UserAccount | null> {
    return toDomain((await this.db.user.findUnique({ where: { id }, select: SELECT })) as Row | null);
  }

  async findByUsername(username: Username): Promise<UserAccount | null> {
    return toDomain(
      (await this.db.user.findUnique({
        where: { username: username.value },
        select: SELECT,
      })) as Row | null,
    );
  }

  async findByReferralCode(code: string): Promise<UserAccount | null> {
    return toDomain(
      (await this.db.user.findUnique({ where: { referralCode: code }, select: SELECT })) as Row | null,
    );
  }

  async findConflicting(params: {
    username?: Username;
    address?: MochimoAddress;
    excludeUserId?: string;
  }): Promise<UserAccount | null> {
    const or: Array<Record<string, string>> = [];
    if (params.username) or.push({ username: params.username.value });
    if (params.address) {
      or.push({ mochimoAddress: params.address.hex }, { mochimoTag: params.address.tag });
    }
    if (or.length === 0) return null;

    return toDomain(
      (await this.db.user.findFirst({
        where: {
          OR: or,
          ...(params.excludeUserId ? { NOT: { id: params.excludeUserId } } : {}),
        },
        select: SELECT,
      })) as Row | null,
    );
  }

  async countSignupsFromIpSince(ipHash: string, since: Date): Promise<number> {
    return this.db.user.count({
      where: { signupIpHash: ipHash, createdAt: { gte: since } },
    });
  }

  async create(user: UserAccount): Promise<UserAccount> {
    const s = user.toSnapshot();
    const row = (await this.db.user.create({
      data: {
        username: s.username,
        passwordHash: s.passwordHash,
        mochimoAddress: s.mochimoAddress,
        mochimoTag: s.mochimoTag,
        referredById: s.referredById,
        signupIpHash: s.signupIpHash,
        name: s.username,
      },
      select: SELECT,
    })) as Row;
    return UserAccount.rehydrate(row);
  }

  async save(user: UserAccount): Promise<UserAccount> {
    const s = user.toSnapshot();
    const row = (await this.db.user.update({
      where: { id: user.id },
      data: {
        mochimoAddress: s.mochimoAddress,
        mochimoTag: s.mochimoTag,
        referredById: s.referredById,
        role: s.role,
        bannedAt: s.bannedAt,
        referralPaidAt: s.referralPaidAt,
      },
      select: SELECT,
    })) as Row;
    return UserAccount.rehydrate(row);
  }
}
