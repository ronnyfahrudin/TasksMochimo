import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { PasswordHash, type PlainPassword } from "@/domain/identity/value-objects";
import type { PasswordHasher } from "@/domain/identity/ports";

// scrypt per OWASP 2024 guidance: N=2^15, r=8, p=1, keyLen=64 — memory hard,
// ~50ms on a modern CPU. Memory cost is 128*N*r ≈ 33.5 MB, above Node's 32 MB
// default, so maxmem is raised explicitly.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
const MAXMEM = 64 * 1024 * 1024;

/**
 * A hash to verify against when no user was found, so an unknown username
 * costs exactly as much time as a known one. Same parameters as a real hash —
 * that equality is the entire point.
 */
const PLACEHOLDER_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${"00".repeat(SALT_LEN)}$${"00".repeat(KEY_LEN)}`;

export class ScryptPasswordHasher implements PasswordHasher {
  /** Format: "scrypt$N$r$p$saltHex$hashHex" — parameters travel with the hash
   *  so they can be hardened later without invalidating existing logins. */
  hash(plain: PlainPassword): PasswordHash {
    const salt = randomBytes(SALT_LEN);
    const digest = scryptSync(plain.value.normalize("NFKC"), salt, KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: MAXMEM,
    });
    return PasswordHash.rehydrate(
      `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${digest.toString("hex")}`,
    );
  }

  verify(plain: string, hash: PasswordHash | null): boolean {
    // A missing hash still runs a full scrypt pass against the placeholder:
    // returning early here would leak account existence through timing.
    const stored = hash?.value ?? PLACEHOLDER_HASH;
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "hex");
    const digest = Buffer.from(parts[5], "hex");
    if (!salt.length || !digest.length || !Number.isFinite(N)) return false;

    try {
      const test = scryptSync(plain.normalize("NFKC"), salt, digest.length, {
        N,
        r,
        p,
        maxmem: MAXMEM,
      });
      const match = test.length === digest.length && timingSafeEqual(test, digest);
      return hash === null ? false : match;
    } catch {
      return false;
    }
  }
}
