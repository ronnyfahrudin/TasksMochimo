import { z } from "zod";

// ── Format constants ─────────────────────────────────────────────────────────
//
// Mochimo addresses have TWO common representations:
//
//   1. Tag (base58 display format)  — what Mochiscan shows, e.g.
//      "226qEKxKSKCXMVtmBFVPKAz7H5aVjgH"  (typically 28–34 chars)
//
//   2. Hex (canonical, 20 bytes)    — what the Mesh API accepts, e.g.
//      "0xd9c0c06c5383eb5cc0159f618101003d3b7abe84"  (42 chars w/ "0x")
//
// We accept both at the user-input layer. On submit we normalize to lowercase
// hex (without "0x" prefix) for storage so duplicate-detection works across
// formats. Mesh on-chain verification only runs when we have the hex form
// (Mochimo's base58 encoding includes prefix + checksum bytes that aren't
// universally reversible without a Mochimo-specific decoder).

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_REGEX = new RegExp(`^[${BASE58_ALPHABET}]+$`);
const HEX_REGEX = /^(0x)?[0-9a-fA-F]{40}$/;

const TAG_MIN = 24;
const TAG_MAX = 64;
const HEX_RAW = 40;

export type AddressFormat = "hex" | "tag";

export function isHexMochimoAddress(input: unknown): input is string {
  return typeof input === "string" && HEX_REGEX.test(input.trim());
}

export function isBase58MochimoTag(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const v = input.trim();
  if (v.length < TAG_MIN || v.length > TAG_MAX) return false;
  // Strip a leading "0x" so we don't accidentally classify a hex address as tag.
  if (/^0x/i.test(v)) return false;
  return BASE58_REGEX.test(v);
}

export function isValidMochimoAddress(input: unknown): input is string {
  return isHexMochimoAddress(input) || isBase58MochimoTag(input);
}

export function detectFormat(input: string): AddressFormat | null {
  if (isHexMochimoAddress(input)) return "hex";
  if (isBase58MochimoTag(input)) return "tag";
  return null;
}

/**
 * Normalize whatever the user typed into a canonical storage form:
 * lowercase hex, no "0x" prefix. For base58 tag input we keep the tag as-is
 * (we cannot reverse Mochimo's custom encoding here), prefixed with "tag:" so
 * the storage column is unambiguous and uniqueness still works.
 */
export function normalizeMochimoAddress(input: string): string {
  const v = input.trim();
  if (isHexMochimoAddress(v)) {
    return v.replace(/^0x/i, "").toLowerCase();
  }
  return `tag:${v}`;
}

/** Inverse of `normalizeMochimoAddress` for display. */
export function denormalizeMochimoAddress(stored: string): string {
  if (stored.startsWith("tag:")) return stored.slice(4);
  if (/^[0-9a-f]{40}$/i.test(stored)) return `0x${stored}`;
  return stored;
}

export const mochimoAddressSchema = z
  .string({ required_error: "Mochimo address is required" })
  .trim()
  .min(TAG_MIN, `Address looks too short (${TAG_MIN}+ chars required)`)
  .max(TAG_MAX, `Address looks too long`)
  .refine((v) => isValidMochimoAddress(v), {
    message:
      "Paste either the hex format (0xd9c0… 40 hex chars) or the base58 tag from Mochiscan.",
  });

// Strict schemas for the two-field signup (Hex + Tag entered separately).
export const mochimoHexSchema = z
  .string({ required_error: "Hex address is required" })
  .trim()
  .refine((v) => isHexMochimoAddress(v), {
    message: "Hex must be 40 hex chars, optionally prefixed with 0x.",
  })
  .transform((v) => v.replace(/^0x/i, "").toLowerCase());

export const mochimoTagSchema = z
  .string({ required_error: "Tag is required" })
  .trim()
  .refine((v) => isBase58MochimoTag(v), {
    message: "Tag must be base58 (no 0/O/I/l), 24–64 chars, as shown on Mochiscan.",
  });

// ── On-chain verification via Mochimo Mesh API (Rosetta) ─────────────────────

export type MeshVerifyResult =
  | { ok: true; balanceMcm: string; blockIndex?: number }
  | { ok: false; reason: string }
  | { ok: "unknown"; reason: string };

const DEFAULT_MESH_URL = "https://api.mochimo.org";

// ── Base58 tag → hex ────────────────────────────────────────────────────────
//
// Mochimo's base58 tag decodes to 22 bytes: the 20-byte account tag followed
// by a 2-byte checksum. Verified against a known pair:
//   "226qEKxKSKCXMVtmBFVPKAz7H5aVjgH"
//     → d9c0c06c5383eb5cc0159f618101003d3b7abe84 + 30be
// The Mesh API only accepts the hex form ("Invalid account format" for base58),
// so every on-chain path goes through this decoder.

/** Decode a base58 Mochimo tag to its 40-char lowercase hex, or null. */
export function base58TagToHex(tag: string): string | null {
  const v = tag.trim();
  if (!isBase58MochimoTag(v)) return null;

  let n = 0n;
  for (const ch of v) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    n = n * 58n + BigInt(idx);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  // Leading "1" chars in base58 are leading zero bytes.
  let leading = 0;
  for (const ch of v) {
    if (ch === BASE58_ALPHABET[0]) leading++;
    else break;
  }
  hex = "00".repeat(leading) + hex;

  // 20-byte tag + 2-byte checksum. Anything else isn't a tag we understand.
  if (hex.length !== 44) return null;
  return hex.slice(0, HEX_RAW).toLowerCase();
}

// ── Deposit address (registration target) ───────────────────────────────────

const DEFAULT_DEPOSIT_TAG = "226qEKxKSKCXMVtmBFVPKAz7H5aVjgH";

/**
 * The wallet users send their registration challenge payment TO. Configure
 * with MOCHIMO_DEPOSIT_TAG (base58, as shown on Mochiscan); MOCHIMO_DEPOSIT_HEX
 * overrides the decoded hex if you ever need to set it by hand.
 *
 * This address receives real MCM — make sure it is a wallet you hold the keys
 * to before deploying.
 */
export function getDepositAddress(): { tag: string; hex: string } {
  const tag = process.env.MOCHIMO_DEPOSIT_TAG?.trim() || DEFAULT_DEPOSIT_TAG;
  const override = process.env.MOCHIMO_DEPOSIT_HEX?.trim();
  const hex = override
    ? override.replace(/^0x/i, "").toLowerCase()
    : base58TagToHex(tag);
  if (!hex || !/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(
      `Could not resolve deposit address from MOCHIMO_DEPOSIT_TAG="${tag}". Set MOCHIMO_DEPOSIT_HEX explicitly.`,
    );
  }
  return { tag, hex };
}

// ── Challenge-payment lookup for proof-of-ownership ─────────────────────────
//
// Registration proof: the user sends an exact, randomly-generated amount FROM
// their wallet TO our deposit address. We accept a transaction only when the
// same tx carries both halves:
//
//   SOURCE op       account.address == user hex, amount < 0
//   DESTINATION op  account.address == deposit hex, amount == challenge
//
// Requiring both means neither an unrelated payment to us nor an unrelated
// payment from the user's wallet can satisfy a claim on its own. Real Mesh
// operations look like this (fee is folded into the source leg):
//
//   SOURCE_TRANSFER       0x1737…3ee6  -200728034
//   DESTINATION_TRANSFER  0xf466…cecc      733035
//   DESTINATION_TRANSFER  0x1737…3ee6   199994499   (change back to sender)
//
// so the exact challenge amount only ever appears on the destination leg —
// which is why we match against that one, not the source total.

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
 * How many recent blocks to scan for an already-confirmed payment. Blocks run
 * ~170s apart, so 8 covers ~23 minutes — comfortably more than a claim's
 * 15-minute lifetime.
 */
const CONFIRMED_BLOCK_LOOKBACK = 8;

export type ChallengePayment = {
  /** Transaction hash carrying the challenge payment. */
  hash: string;
  /** false = still in the mempool, true = already in a block. */
  confirmed: boolean;
};

type ChallengeQuery = {
  /** Sender: the wallet being claimed (40 hex chars, no prefix). */
  fromHex: string;
  /** Recipient: our deposit wallet (40 hex chars, no prefix). */
  toHex: string;
  /** Exact amount in nMCM the destination leg must carry. */
  nanoMcm: number;
  /** How many recent blocks to scan for a confirmed payment. */
  lookbackBlocks?: number;
  meshUrl?: string;
  network?: string;
  timeoutMs?: number;
};

function opAddress(op: RosettaOperation): string | null {
  return op.account?.address?.replace(/^0x/i, "").toLowerCase() ?? null;
}

function txCarriesChallenge(tx: RosettaTransaction, q: ChallengeQuery): boolean {
  const ops = tx.operations ?? [];
  const from = q.fromHex.replace(/^0x/i, "").toLowerCase();
  const to = q.toHex.replace(/^0x/i, "").toLowerCase();

  const spentByClaimer = ops.some((op) => {
    if (opAddress(op) !== from) return false;
    const value = Number(op.amount?.value);
    return Number.isFinite(value) && value < 0;
  });
  if (!spentByClaimer) return false;

  return ops.some((op) => {
    if (opAddress(op) !== to) return false;
    const value = Number(op.amount?.value);
    return Number.isFinite(value) && value === q.nanoMcm;
  });
}

/**
 * Look for the challenge payment: first in the mempool (shows up seconds after
 * the user hits send), then in the most recent blocks (for a payment that was
 * already mined).
 *
 * Returns the matching payment, or null when nothing matches yet. Network
 * errors also return null so the caller just keeps polling.
 */
export async function findChallengePayment(
  q: ChallengeQuery,
): Promise<ChallengePayment | null> {
  const meshUrl = (q.meshUrl ?? process.env.MOCHIMO_MESH_URL ?? DEFAULT_MESH_URL).replace(
    /\/$/,
    "",
  );
  const network = q.network ?? process.env.MOCHIMO_MESH_NETWORK ?? "mainnet";
  const networkIdentifier = { blockchain: "mochimo", network };

  // Each request gets its own deadline. One shared budget doesn't work here:
  // /mempool/transaction is slow enough that walking the mempool can eat the
  // whole allowance and abort the search that follows it.
  const perRequestMs = q.timeoutMs ?? 8000;
  const post = async (path: string, body: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perRequestMs);
    try {
      const r = await fetch(`${meshUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!r.ok) return null;
      return (await r.json()) as Record<string, unknown>;
    } catch {
      return null; // timeout or network blip — caller treats it as "not yet"
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. Mempool — the common case: the user is watching the page and the
  //    payment shows up pending within seconds of them hitting send.
  const list = (await post("/mempool", { network_identifier: networkIdentifier })) as {
    transaction_identifiers?: RosettaTxIdentifier[];
  } | null;

  for (const { hash } of (list?.transaction_identifiers ?? []).slice(0, MEMPOOL_SCAN_LIMIT)) {
    const data = (await post("/mempool/transaction", {
      network_identifier: networkIdentifier,
      transaction_identifier: { hash },
    })) as { transaction?: RosettaTransaction } | null;
    if (data?.transaction && txCarriesChallenge(data.transaction, q)) {
      return { hash, confirmed: false };
    }
  }

  // 2. Recent blocks — catches a payment that was already mined, e.g. the user
  //    closed the tab or the poll landed after the block. /block is fast
  //    (~0.3-0.8s, a few KB); /search/transactions is not usable here — on the
  //    public node it takes 17s+ for a 5-row page and times out around 50.
  const status = (await post("/network/status", {
    network_identifier: networkIdentifier,
  })) as { current_block_identifier?: { index?: number } } | null;

  const head = status?.current_block_identifier?.index;
  if (typeof head !== "number") return null;

  const lookback = q.lookbackBlocks ?? CONFIRMED_BLOCK_LOOKBACK;
  for (let index = head; index > head - lookback && index >= 0; index--) {
    const data = (await post("/block", {
      network_identifier: networkIdentifier,
      block_identifier: { index },
    })) as { block?: { transactions?: RosettaTransaction[] } } | null;

    for (const tx of data?.block?.transactions ?? []) {
      if (txCarriesChallenge(tx, q)) {
        const hash = tx.transaction_identifier?.hash;
        if (hash) return { hash, confirmed: true };
      }
    }
  }

  return null;
}

export async function verifyMochimoAddressOnchain(
  input: string,
  opts: { timeoutMs?: number; meshUrl?: string; network?: string } = {},
): Promise<MeshVerifyResult> {
  const v = input.trim();
  const fmt = detectFormat(v);
  if (!fmt) return { ok: false, reason: "Invalid base58/hex format" };

  // Mesh API requires hex with "0x" prefix. Base58 tags are decoded first
  // (see base58TagToHex); a tag we can't decode soft-fails to "unknown" so a
  // format we don't recognise never locks a user out.
  let hexInput = v;
  if (fmt === "tag") {
    const decoded = base58TagToHex(v);
    if (!decoded) {
      return {
        ok: "unknown",
        reason: "Could not decode base58 tag — paste hex (0x…) to enable on-chain verification.",
      };
    }
    hexInput = decoded;
  }

  const hex = hexInput.startsWith("0x") ? hexInput.toLowerCase() : `0x${hexInput.toLowerCase()}`;
  if (hex.length !== HEX_RAW + 2) {
    return { ok: false, reason: `Expected 40 hex chars after 0x, got ${hex.length - 2}` };
  }

  const meshUrl = opts.meshUrl ?? process.env.MOCHIMO_MESH_URL ?? DEFAULT_MESH_URL;
  const network = opts.network ?? process.env.MOCHIMO_MESH_NETWORK ?? "mainnet";
  const timeoutMs = opts.timeoutMs ?? 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(`${meshUrl.replace(/\/$/, "")}/account/balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        network_identifier: { blockchain: "mochimo", network },
        account_identifier: { address: hex },
      }),
    });

    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as {
        code?: number;
        message?: string;
      };

      // Code 4 "Account not found" is technically not-OK from Rosetta but
      // for our purposes the format IS valid — Mesh just hasn't seen the
      // address yet. Treat as verified-but-zero-balance.
      if (body.code === 4) {
        return { ok: true, balanceMcm: "0" };
      }
      if (body.code != null) {
        return { ok: false, reason: body.message ?? `Mesh error code ${body.code}` };
      }
      if (r.status >= 500) {
        return { ok: "unknown", reason: `Mesh upstream ${r.status}` };
      }
      return { ok: false, reason: `Mesh rejected (${r.status})` };
    }

    const data = (await r.json()) as {
      block_identifier?: { index?: number };
      balances?: Array<{ value: string; currency?: { symbol?: string } }>;
    };
    const mcm = data.balances?.find((b) => b.currency?.symbol === "MCM");
    return {
      ok: true,
      balanceMcm: mcm?.value ?? data.balances?.[0]?.value ?? "0",
      blockIndex: data.block_identifier?.index,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: "unknown", reason: `Mesh unreachable: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
