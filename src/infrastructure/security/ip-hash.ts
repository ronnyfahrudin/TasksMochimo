import { createHmac } from "node:crypto";

/**
 * Salted, one-way fingerprint of a sign-up address.
 *
 * We never store the raw IP: the only question this data answers is "did these
 * two accounts open from the same place?", and a keyed hash answers it without
 * keeping anything readable. Keyed with AUTH_SECRET so the hashes are useless
 * outside this deployment and cannot be reversed with a table of every IPv4.
 *
 * Returns null when there is nothing trustworthy to hash — the caller then
 * treats origin as unknown rather than lumping every unknown together.
 */
export function hashSignupIp(ip: string | null | undefined): string | null {
  const value = ip?.trim();
  if (!value || value === "unknown") return null;

  const key = process.env.AUTH_SECRET;
  if (!key) {
    console.warn("[security] AUTH_SECRET missing — sign-up origin will not be recorded");
    return null;
  }

  return createHmac("sha256", key).update(value).digest("hex").slice(0, 32);
}
