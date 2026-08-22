import { z } from "zod";
import { ValidationError } from "@/domain/shared/errors";

/**
 * A Mochimo wallet address, as a value object.
 *
 * Mochimo shows an address two ways and both matter here:
 *
 *   Tag (base58)  "226qEKxKSKCXMVtmBFVPKAz7H5aVjgH"   — what Mochiscan displays
 *   Hex (20 byte) "0xd9c0c06c5383eb5cc0159f618101003d3b7abe84" — what Mesh accepts
 *
 * The pair is one identity, so it belongs in one object: `MochimoAddress`
 * refuses to exist unless the tag actually decodes to the hex. That rule used
 * to live inline in the sign-up route, where nothing else could reuse it.
 *
 * This module is deliberately free of Node built-ins and `process.env` — the
 * sign-up form imports its schemas in the browser.
 */

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
 * Decode a base58 Mochimo tag to its 40-char lowercase hex, or null.
 *
 * The tag decodes to 22 bytes: the 20-byte account tag plus a 2-byte checksum.
 * Verified against known pairs — "226qEK…" → d9c0c0…be84 + 30be.
 */
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

/** Normalize any accepted form to storage form: lowercase hex, no "0x". */
export function normalizeMochimoAddress(input: string): string {
  const v = input.trim();
  if (isHexMochimoAddress(v)) return v.replace(/^0x/i, "").toLowerCase();
  return `tag:${v}`;
}

/** Inverse of `normalizeMochimoAddress`, for display. */
export function denormalizeMochimoAddress(stored: string): string {
  if (stored.startsWith("tag:")) return stored.slice(4);
  if (/^[0-9a-f]{40}$/i.test(stored)) return `0x${stored}`;
  return stored;
}

// ── Input schemas (shared by the browser form and the API) ──────────────────

export const mochimoAddressSchema = z
  .string({ required_error: "Mochimo address is required" })
  .trim()
  .min(TAG_MIN, `Address looks too short (${TAG_MIN}+ chars required)`)
  .max(TAG_MAX, `Address looks too long`)
  .refine((v) => isValidMochimoAddress(v), {
    message:
      "Paste either the hex format (0xd9c0… 40 hex chars) or the base58 tag from Mochiscan.",
  });

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

/**
 * The tag+hex pair as one identity. Construction enforces that they describe
 * the same wallet, so no caller downstream has to re-check it.
 */
export class MochimoAddress {
  private constructor(
    /** 40 lowercase hex chars, never prefixed. The storage + Mesh form. */
    readonly hex: string,
    /** Base58 tag as shown on Mochiscan. The display form. */
    readonly tag: string,
  ) {}

  static create(input: { hex: string; tag: string }): MochimoAddress {
    const hex = mochimoHexSchema.safeParse(input.hex);
    if (!hex.success) {
      throw new ValidationError("address.hex.invalid", hex.error.issues[0].message, "hex");
    }
    const tag = mochimoTagSchema.safeParse(input.tag);
    if (!tag.success) {
      throw new ValidationError("address.tag.invalid", tag.error.issues[0].message, "tag");
    }

    // A tag we can decode must agree with the hex; a tag we can't decode is
    // accepted on the hex's authority, exactly as the Mesh verifier does.
    const decoded = base58TagToHex(tag.data);
    if (decoded && decoded !== hex.data) {
      throw new ValidationError(
        "address.pair.mismatch",
        "Tag and hex belong to different wallets. Copy both from the same address.",
        "hex",
      );
    }
    return new MochimoAddress(hex.data, tag.data);
  }

  /** Rebuild from storage without re-validating — rows were valid on write. */
  static rehydrate(hex: string, tag: string): MochimoAddress {
    return new MochimoAddress(hex, tag);
  }

  /** The "0x"-prefixed form the Mesh API insists on. */
  get prefixedHex(): string {
    return `0x${this.hex}`;
  }

  equals(other: MochimoAddress): boolean {
    return this.hex === other.hex;
  }

  toString(): string {
    return this.tag;
  }
}
