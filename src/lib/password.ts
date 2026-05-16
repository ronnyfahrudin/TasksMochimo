import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// scrypt parameters per OWASP 2024 guidance:
//   N=2^15 (32768), r=8, p=1, keyLen=64. Memory hard, ~50ms on modern CPU.
// Memory cost = 128 * N * r ≈ 33.5 MB — Node's default `maxmem` is 32 MB,
// so we explicitly raise it to 64 MB to give a margin.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
const MAXMEM = 64 * 1024 * 1024;

/**
 * Hash a plaintext password. Output format: "scrypt$N$r$p$saltHex$hashHex".
 * Future-proof: by encoding the parameters we can rotate to harder params and
 * still verify legacy hashes.
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(plain.normalize("NFKC"), salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time password verification. Returns false on any malformed hash. */
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const hash = Buffer.from(parts[5], "hex");
  if (!salt.length || !hash.length || !Number.isFinite(N)) return false;
  try {
    const test = scryptSync(plain.normalize("NFKC"), salt, hash.length, {
      N,
      r,
      p,
      maxmem: MAXMEM,
    });
    return test.length === hash.length && timingSafeEqual(test, hash);
  } catch {
    return false;
  }
}

/**
 * Basic strength check. We're permissive (8+ chars) since this is a prototype
 * faucet, not a bank.
 */
export function passwordStrength(plain: string): { ok: true } | { ok: false; reason: string } {
  if (plain.length < 8) return { ok: false, reason: "Password must be at least 8 characters" };
  if (plain.length > 128) return { ok: false, reason: "Password is too long (max 128)" };
  return { ok: true };
}
