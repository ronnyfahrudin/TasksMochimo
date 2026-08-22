import { TooSoonError } from "@/domain/shared/errors";

/**
 * A small in-process sliding-window limiter.
 *
 * There was no rate limiting anywhere in this app: sign-in could be brute
 * forced at line speed against an 8-character minimum password, and
 * `start-claim` — which writes a row and reserves a challenge amount — could be
 * flooded for free. This closes both at the cheapest place that actually helps.
 *
 * Honest limits of this implementation: state lives in the process, so it
 * counts per instance. On a single server that is the real limit; on several
 * instances (or serverless) each one enforces its own share, which still caps
 * a single attacker's throughput but is not a global budget. Move the counters
 * to Redis (Upstash) when the deployment grows past one instance.
 */

type Hits = number[];

const buckets = new Map<string, Hits>();
let lastSweep = Date.now();

/** Drop buckets nothing has touched for a while, so the map cannot grow forever. */
function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((t) => now - t < windowMs);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}

export type RateLimitRule = {
  /** Distinct name so two rules never share a bucket. */
  name: string;
  limit: number;
  windowMs: number;
};

/**
 * Record one attempt against `identity` and report whether it is allowed.
 * Callers that want an error instead should use {@link enforceRateLimit}.
 */
export function checkRateLimit(
  rule: RateLimitRule,
  identity: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
  sweep(now, rule.windowMs);

  const key = `${rule.name}:${identity}`;
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < rule.windowMs);

  if (hits.length >= rule.limit) {
    buckets.set(key, hits);
    const oldest = hits[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((rule.windowMs - (now - oldest)) / 1000)),
      remaining: 0,
    };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, retryAfterSeconds: 0, remaining: rule.limit - hits.length };
}

/** Same as {@link checkRateLimit}, but throws the domain's TooSoonError. */
export function enforceRateLimit(rule: RateLimitRule, identity: string): void {
  const result = checkRateLimit(rule, identity);
  if (!result.allowed) {
    throw new TooSoonError(
      "rate_limited",
      "Too many attempts. Try again shortly.",
      result.retryAfterSeconds,
    );
  }
}

/**
 * Best-effort client address.
 *
 * Proxy headers are attacker-controlled unless a trusted proxy sets them, so
 * this is a throttling key, never an identity or an authorization input. The
 * leftmost `x-forwarded-for` entry is what Vercel and most proxies put the
 * real client in.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export const RULES = {
  /** Password guessing, per source address. */
  signInPerIp: { name: "signin:ip", limit: 10, windowMs: 5 * 60_000 },
  /** Password guessing against one account, wherever it comes from. */
  signInPerUser: { name: "signin:user", limit: 5, windowMs: 15 * 60_000 },
  /**
   * Claim opening. Also the brute-force surface for the challenge amount, so
   * it is deliberately tighter than it needs to be for honest use: a real
   * sign-up opens one claim, maybe two after a mistake.
   */
  startClaimPerIp: { name: "claim:ip", limit: 8, windowMs: 10 * 60_000 },
  /**
   * Finishing a sign-up. Its own bucket on purpose: sharing `start-claim`'s
   * meant the two spent each other's budget, and the per-origin account cap
   * could never be reached because the limiter always fired first.
   */
  signupPerIp: { name: "signup:ip", limit: 6, windowMs: 10 * 60_000 },
  /** Proof submission, to keep the AI moderator from being used as a toy. */
  submitPerUser: { name: "submit:user", limit: 20, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;
