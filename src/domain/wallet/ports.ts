import type { MochimoAddress } from "./mochimo-address";
import type { WalletClaim } from "./wallet-claim";

export interface WalletClaimRepository {
  findByToken(token: string): Promise<WalletClaim | null>;
  /** Challenge amounts reserved by claims that are still live. */
  liveChallengeAmounts(now: Date): Promise<Set<number>>;
  save(claim: WalletClaim): Promise<WalletClaim>;
  /** Housekeeping: drop claims that expired without ever verifying. */
  purgeExpired(now: Date): Promise<number>;
}

export type ChallengePayment = {
  hash: string;
  /** false = still in the mempool, true = already in a block. */
  confirmed: boolean;
};

export type AddressCheck =
  | { ok: true; balanceMcm: string; blockIndex?: number }
  | { ok: false; reason: string }
  | { ok: "unknown"; reason: string };

/**
 * Read model over the Mochimo Mesh (Rosetta) API.
 *
 * The domain asks "has this wallet paid me exactly this?" and "is this address
 * real?" — how that is answered (mempool first, then a block scan, with which
 * timeouts) is an infrastructure concern.
 */
export interface MeshGateway {
  findChallengePayment(query: {
    from: MochimoAddress;
    toHex: string;
    nanoMcm: number;
    /** Payments older than the claim itself are not proof of it. */
    notBefore: Date;
  }): Promise<ChallengePayment | null>;

  checkAddress(address: MochimoAddress): Promise<AddressCheck>;
}
