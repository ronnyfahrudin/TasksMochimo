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

// ── Mempool watch for proof-of-ownership ────────────────────────────────────
//
// Forum-mochimo-style verification: instead of trusting "this hex exists on
// chain", we wait for the user to trigger a fresh transaction FROM that hex.
// Mesh exposes /mempool (list of pending tx hashes) + /mempool/transaction
// (operations of a specific pending tx). For each pending tx we inspect every
// operation's account.address — if it matches the claimed hex, we have proof
// the wallet holder is the one initiating the action.
//
// Returns the tx hash that matched, or null if no match yet. Network errors
// → null (treat as "still pending"); pages will keep polling.

type RosettaTxIdentifier = { hash: string };
type RosettaOperation = {
  account?: { address?: string };
  amount?: { value?: string; currency?: { symbol?: string; decimals?: number } };
};

/**
 * Watch the Mesh mempool for a tx FROM the given hex whose operation amount
 * matches `challengeNanoMcm` (if provided). Returns the matching tx hash or
 * null.
 *
 * The challenge filter eliminates the false-positive case where the user
 * happens to have an unrelated pending tx — only a tx with the exact amount
 * we asked for proves ownership.
 */
export async function checkMempoolForAddress(
  hexNoPrefix: string,
  opts: {
    challengeNanoMcm?: number;
    meshUrl?: string;
    network?: string;
    timeoutMs?: number;
  } = {},
): Promise<string | null> {
  const meshUrl = opts.meshUrl ?? process.env.MOCHIMO_MESH_URL ?? DEFAULT_MESH_URL;
  const network = opts.network ?? process.env.MOCHIMO_MESH_NETWORK ?? "mainnet";
  const timeoutMs = opts.timeoutMs ?? 8000;
  const target = `0x${hexNoPrefix.toLowerCase()}`;
  const networkIdentifier = { blockchain: "mochimo", network };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const listRes = await fetch(`${meshUrl.replace(/\/$/, "")}/mempool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ network_identifier: networkIdentifier }),
    });
    if (!listRes.ok) return null;

    const listData = (await listRes.json()) as {
      transaction_identifiers?: RosettaTxIdentifier[];
    };
    const ids = listData.transaction_identifiers ?? [];
    if (ids.length === 0) return null;

    // Sequentially inspect — mempool is usually small for Mochimo, and
    // parallel fan-out can rate-limit a public node.
    for (const { hash } of ids) {
      if (controller.signal.aborted) break;
      const txRes = await fetch(`${meshUrl.replace(/\/$/, "")}/mempool/transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          network_identifier: networkIdentifier,
          transaction_identifier: { hash },
        }),
      });
      if (!txRes.ok) continue;
      const txData = (await txRes.json()) as {
        transaction?: { operations?: RosettaOperation[] };
      };
      const ops = txData.transaction?.operations ?? [];
      const matched = ops.some((op) => {
        if (op.account?.address?.toLowerCase() !== target) return false;
        if (opts.challengeNanoMcm == null) return true;
        const raw = op.amount?.value;
        if (raw == null) return false;
        // Operation amount may be a signed string; we compare absolute value
        // because the same tx has +N for the recipient and -N for the sender.
        const abs = Math.abs(Number(raw));
        return Number.isFinite(abs) && abs === opts.challengeNanoMcm;
      });
      if (matched) return hash;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyMochimoAddressOnchain(
  input: string,
  opts: { timeoutMs?: number; meshUrl?: string; network?: string } = {},
): Promise<MeshVerifyResult> {
  const v = input.trim();
  const fmt = detectFormat(v);
  if (!fmt) return { ok: false, reason: "Invalid base58/hex format" };

  // Mesh API requires hex with "0x" prefix. We can't reliably decode the
  // base58 tag without Mochimo-specific code, so we soft-fail to "unknown"
  // for tag input — the account is still created, just flagged unverified.
  if (fmt === "tag") {
    return {
      ok: "unknown",
      reason: "Base58 tag accepted as-is — paste hex (0x…) to enable on-chain verification.",
    };
  }

  const hex = v.startsWith("0x") ? v.toLowerCase() : `0x${v.toLowerCase()}`;
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
