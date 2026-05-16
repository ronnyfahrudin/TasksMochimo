import { z } from "zod";

// Base58 alphabet (Bitcoin / Mochimo Mesh) — excludes 0, O, I, l.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_REGEX = new RegExp(`^[${BASE58_ALPHABET}]+$`);

// Mochimo Mesh tagged address length (post-MeshAPI) is typically 40 characters,
// the legacy WOTS+ public address is much longer (2208 bytes hex). For the
// user-facing wallet field we accept the modern tagged form: 32–64 base58 chars.
const MIN_LEN = 32;
const MAX_LEN = 64;

export function isValidMochimoAddress(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const v = input.trim();
  if (v.length < MIN_LEN || v.length > MAX_LEN) return false;
  return BASE58_REGEX.test(v);
}

export const mochimoAddressSchema = z
  .string({ required_error: "Mochimo address is required" })
  .trim()
  .min(MIN_LEN, `Must be at least ${MIN_LEN} characters`)
  .max(MAX_LEN, `Must be at most ${MAX_LEN} characters`)
  .refine((v) => BASE58_REGEX.test(v), {
    message:
      "Invalid Mochimo address — must be base58 (no 0, O, I, l). Check for typos.",
  });

export function normalizeMochimoAddress(input: string) {
  return input.trim();
}
