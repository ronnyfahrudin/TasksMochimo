import type { MochimoAddress } from "@/domain/wallet/mochimo-address";
import type { AddressCheck, ChallengePayment, MeshGateway } from "@/domain/wallet/ports";
import { meshSettings } from "@/infrastructure/config/app-config";

// ── Rosetta shapes we care about ────────────────────────────────────────────
type RosettaTxIdentifier = { hash: string };
type RosettaOperation = {
  type?: string;
  account?: { address?: string };
  amount?: { value?: string; currency?: { symbol?: string; decimals?: number } };
};
type RosettaTransaction = {
  transaction_identifier?: RosettaTxIdentifier;
  operations?: RosettaOperation[];
};

/** Upper bound on mempool entries inspected per check (one request each). */
const MEMPOOL_SCAN_LIMIT = 10;
/**
 * Blocks to scan for an already-mined payment. Blocks run ~170s apart, so 8
 * covers ~23 minutes — comfortably longer than a claim's 15-minute life. Raise
 * this if the claim TTL is raised, or a claim can outlive the scan's reach.
 */
const CONFIRMED_BLOCK_LOOKBACK = 8;
const PER_REQUEST_TIMEOUT_MS = 8000;
/**
 * Tolerance for node/server clock disagreement when deciding whether a mined
 * block could possibly hold a payment made after a claim opened.
 */
const CLOCK_SKEW_MS = 60_000;

function opAddress(op: RosettaOperation): string | null {
  return op.account?.address?.replace(/^0x/i, "").toLowerCase() ?? null;
}

/**
 * The Mochimo Mesh (Rosetta) API.
 *
 * A payment counts only when ONE transaction carries both legs: a negative
 * amount from the claimed wallet, and exactly the challenge amount to the
 * deposit address. The fee is folded into the source leg
 * (−200728034 for a 733035 transfer plus 500 fee), so the challenge value only
 * ever appears verbatim on the destination leg — matching both halves is what
 * stops an unrelated payment to us, or an unrelated spend by the user, from
 * satisfying a claim on its own.
 */
export class MochimoMeshGateway implements MeshGateway {
  private readonly url: string;
  private readonly network: string;

  constructor(settings = meshSettings()) {
    this.url = settings.url;
    this.network = settings.network;
  }

  private get networkIdentifier() {
    return { blockchain: "mochimo", network: this.network };
  }

  /**
   * Each request gets its own deadline. A single shared budget doesn't work:
   * /mempool/transaction is slow enough that walking the mempool can eat the
   * whole allowance and abort the block scan that follows it.
   */
  private async post(path: string, body: unknown, timeoutMs = PER_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(`${this.url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!r.ok) return { ok: false as const, status: r.status, body: await r.json().catch(() => null) };
      return { ok: true as const, status: r.status, body: (await r.json()) as Record<string, unknown> };
    } catch {
      return null; // timeout or network blip
    } finally {
      clearTimeout(timer);
    }
  }

  private carriesChallenge(
    tx: RosettaTransaction,
    q: { fromHex: string; toHex: string; nanoMcm: number },
  ): boolean {
    const ops = tx.operations ?? [];

    const spentByClaimer = ops.some((op) => {
      if (opAddress(op) !== q.fromHex) return false;
      const value = Number(op.amount?.value);
      return Number.isFinite(value) && value < 0;
    });
    if (!spentByClaimer) return false;

    return ops.some((op) => {
      if (opAddress(op) !== q.toHex) return false;
      const value = Number(op.amount?.value);
      return Number.isFinite(value) && value === q.nanoMcm;
    });
  }

  async findChallengePayment(query: {
    from: MochimoAddress;
    toHex: string;
    nanoMcm: number;
    /**
     * The moment the claim opened. A payment made BEFORE that instant cannot
     * be proof of this claim — without this bound, an attacker who spots any
     * historical payment between two wallets can open claims until the random
     * challenge happens to match it, and register someone else's wallet.
     */
    notBefore: Date;
  }): Promise<ChallengePayment | null> {
    const q = {
      fromHex: query.from.hex,
      toHex: query.toHex.replace(/^0x/i, "").toLowerCase(),
      nanoMcm: query.nanoMcm,
    };
    // A zero challenge can never be satisfied on chain; don't ask the node.
    if (q.nanoMcm <= 0) return null;

    // 1. Mempool — the common case: the user is watching the page and their
    //    payment appears pending within seconds of hitting send.
    const list = await this.post("/mempool", { network_identifier: this.networkIdentifier });
    const pending =
      (list?.ok ? (list.body as { transaction_identifiers?: RosettaTxIdentifier[] }) : null)
        ?.transaction_identifiers ?? [];

    for (const { hash } of pending.slice(0, MEMPOOL_SCAN_LIMIT)) {
      const res = await this.post("/mempool/transaction", {
        network_identifier: this.networkIdentifier,
        transaction_identifier: { hash },
      });
      const tx = res?.ok ? (res.body as { transaction?: RosettaTransaction }).transaction : null;
      if (tx && this.carriesChallenge(tx, q)) return { hash, confirmed: false };
    }

    // 2. Recent blocks — catches a payment already mined (tab closed, or the
    //    poll landed after the block). /block answers in well under a second;
    //    /search/transactions is unusable here — 17s+ for a 5-row page on the
    //    public node, and it times out near 50.
    const status = await this.post("/network/status", {
      network_identifier: this.networkIdentifier,
    });
    const head = status?.ok
      ? (status.body as { current_block_identifier?: { index?: number } }).current_block_identifier
          ?.index
      : undefined;
    if (typeof head !== "number") return null;

    const earliestAcceptable = +query.notBefore - CLOCK_SKEW_MS;

    for (let index = head; index > head - CONFIRMED_BLOCK_LOOKBACK && index >= 0; index--) {
      const res = await this.post("/block", {
        network_identifier: this.networkIdentifier,
        block_identifier: { index },
      });
      const block = res?.ok
        ? (res.body as {
            block?: { timestamp?: number; transactions?: RosettaTransaction[] };
          }).block
        : null;

      // Blocks walk backwards in time, so the first one older than the claim
      // ends the search: nothing beyond it can be proof of this claim.
      const minedAt = block?.timestamp;
      if (typeof minedAt !== "number") {
        // No timestamp means we cannot prove the payment came after the claim.
        // Refuse to match rather than accept an unbounded one.
        console.warn(`[mesh] block ${index} has no timestamp — skipped`);
        continue;
      }
      if (minedAt < earliestAcceptable) break;

      for (const tx of block?.transactions ?? []) {
        if (this.carriesChallenge(tx, q)) {
          const hash = tx.transaction_identifier?.hash;
          if (hash) return { hash, confirmed: true };
        }
      }
    }

    return null;
  }

  /**
   * Format + existence check.
   *
   * "Account not found" (code 4) means a valid, empty wallet — fresh addresses
   * exist on Mochiscan with no on-chain history. A network failure returns
   * "unknown" so a flaky public node never locks a user out of their account.
   */
  async checkAddress(address: MochimoAddress): Promise<AddressCheck> {
    const res = await this.post(
      "/account/balance",
      {
        network_identifier: this.networkIdentifier,
        account_identifier: { address: address.prefixedHex },
      },
      5000,
    );

    if (!res) return { ok: "unknown", reason: "Mesh API unreachable or timed out" };

    if (!res.ok) {
      const err = res.body as { code?: number; message?: string } | null;
      // Code 4 "Account not found" is not-OK to Rosetta but valid to us: the
      // format parsed, Mesh just has no history for it yet.
      if (err?.code === 4) return { ok: true, balanceMcm: "0" };
      if (err?.code != null) {
        return { ok: false, reason: err.message ?? `Mesh error code ${err.code}` };
      }
      // A server-side fault is our problem, not the user's address.
      if (res.status >= 500) return { ok: "unknown", reason: `Mesh upstream ${res.status}` };
      return { ok: false, reason: `Mesh rejected (${res.status})` };
    }

    const data = res.body as {
      block_identifier?: { index?: number };
      balances?: Array<{ value?: string; currency?: { symbol?: string } }>;
    };
    const mcm = data.balances?.find((b) => b.currency?.symbol === "MCM");
    return {
      ok: true,
      balanceMcm: mcm?.value ?? data.balances?.[0]?.value ?? "0",
      blockIndex: data.block_identifier?.index,
    };
  }
}
