import { base58TagToHex } from "@/domain/wallet/mochimo-address";
import type { RegistrationSettings } from "@/domain/wallet/registration-policy";

/**
 * Every `process.env` read in the app lives here.
 *
 * The domain must be configurable without being environment-aware: policies
 * take settings, they don't go looking for them. This module is the one place
 * that translates deployment config into domain settings.
 */

const CLAIM_TTL_SEC = 15 * 60; // enough time to open a wallet and send
const MIN_CHECK_INTERVAL_MS = 6000; // above the client's 5s poll

/**
 * Free public-testing mode. On means: no payment, and wallet ownership is
 * proven by nothing at all. Only ever for a throwaway beta database.
 */
export function freeSignupEnabled(): boolean {
  return process.env.FREE_SIGNUP_MODE?.trim().toLowerCase() === "on";
}

/** The wallet that receives registration payments, or null when none is needed. */
function depositAddress(): { hex: string; tag: string } | null {
  if (freeSignupEnabled()) return null;

  // No default: a deploy that forgets MOCHIMO_DEPOSIT_TAG must REFUSE to take
  // registrations, not quietly collect every registrant's MCM into whatever
  // address happened to be baked into the source.
  const tag = process.env.MOCHIMO_DEPOSIT_TAG?.trim();
  if (!tag) return null;

  const override = process.env.MOCHIMO_DEPOSIT_HEX?.trim();
  const hex = override ? override.replace(/^0x/i, "").toLowerCase() : base58TagToHex(tag);
  if (!hex || !/^[0-9a-f]{40}$/.test(hex)) return null;
  return { tag, hex };
}

export function registrationSettings(): RegistrationSettings {
  return {
    depositAddress: depositAddress(),
    claimTtlSeconds: CLAIM_TTL_SEC,
    minCheckIntervalMs: MIN_CHECK_INTERVAL_MS,
    freeSignup: freeSignupEnabled(),
  };
}

export function meshSettings() {
  return {
    url: (process.env.MOCHIMO_MESH_URL ?? "https://api.mochimo.org").replace(/\/$/, ""),
    network: process.env.MOCHIMO_MESH_NETWORK ?? "mainnet",
  };
}

/**
 * Session cookie name: browsers only honour "__Secure-" over HTTPS.
 *
 * Production is assumed to be HTTPS regardless of what AUTH_URL says — a typo
 * there used to silently drop both the prefix and the `secure` flag, shipping
 * session cookies that travel in the clear with nothing in the logs to show
 * for it. A genuinely plain-HTTP production deploy must opt in loudly.
 */
export function sessionCookieName(): string {
  const httpsConfigured = process.env.AUTH_URL?.startsWith("https://") ?? false;
  const allowInsecure = process.env.AUTH_ALLOW_INSECURE_COOKIES === "true";
  const production = process.env.NODE_ENV === "production";

  if (production && !httpsConfigured && !allowInsecure) {
    console.warn(
      "[security] AUTH_URL is not https in production — issuing __Secure- cookies anyway. " +
        "Fix AUTH_URL, or set AUTH_ALLOW_INSECURE_COOKIES=true if this really is plain HTTP.",
    );
  }

  const secure = httpsConfigured || (production && !allowInsecure);
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET;
}
