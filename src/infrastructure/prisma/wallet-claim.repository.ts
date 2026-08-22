import type { WalletClaimRepository } from "@/domain/wallet/ports";
import { WalletClaim } from "@/domain/wallet/wallet-claim";
import type { PrismaLike } from "./client";

export class PrismaWalletClaimRepository implements WalletClaimRepository {
  constructor(private readonly db: PrismaLike) {}

  async findByToken(token: string): Promise<WalletClaim | null> {
    const row = await this.db.walletClaim.findUnique({ where: { claimToken: token } });
    return row ? WalletClaim.rehydrate(row) : null;
  }

  async liveChallengeAmounts(now: Date): Promise<Set<number>> {
    const rows = await this.db.walletClaim.findMany({
      where: { expiresAt: { gt: now }, consumedAt: null },
      select: { challengeNanoMcm: true },
    });
    return new Set(rows.map((r) => r.challengeNanoMcm));
  }

  async save(claim: WalletClaim): Promise<WalletClaim> {
    const s = claim.toSnapshot();
    const data = {
      hex: s.hex,
      tag: s.tag,
      challengeNanoMcm: s.challengeNanoMcm,
      expiresAt: s.expiresAt,
      lastCheckedAt: s.lastCheckedAt,
      verifiedAt: s.verifiedAt,
      verifiedTxHash: s.verifiedTxHash,
      consumedAt: s.consumedAt,
    };
    const row = s.id
      ? await this.db.walletClaim.update({ where: { id: s.id }, data })
      : await this.db.walletClaim.create({
          data: { ...data, claimToken: s.claimToken, startedAt: s.startedAt },
        });
    return WalletClaim.rehydrate(row);
  }

  async purgeExpired(now: Date): Promise<number> {
    const { count } = await this.db.walletClaim.deleteMany({
      where: { expiresAt: { lt: now }, verifiedAt: null },
    });
    return count;
  }
}
