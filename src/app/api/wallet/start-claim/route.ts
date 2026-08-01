import { NextResponse } from "next/server";
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { mochimoHexSchema, mochimoTagSchema } from "@/lib/mochimo";

const CLAIM_TTL_SEC = 60; // 1 minute window
const CHALLENGE_MIN = 100;
const CHALLENGE_MAX = 999_999; // up to 999_999 nMCM (~0.000999999 MCM)

const BodySchema = z.object({
  hex: mochimoHexSchema,
  tag: mochimoTagSchema,
});

/**
 * Open a wallet-ownership claim. The client posts the wallet hex + display
 * tag; we issue a `claimToken` and a 15-minute window in which we'll watch
 * the Mochimo Mesh mempool for any tx whose `account.address` matches the
 * hex. The user proves ownership by triggering ANY transaction from that
 * wallet (cheapest: send 0.000001 MCM to themselves).
 *
 * If the hex is already registered to an existing User, we reject early
 * (409) — no point letting them try to verify a wallet they can't claim.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue?.message ?? "Invalid body", field: issue?.path?.[0] },
      { status: 400 },
    );
  }
  const { hex, tag } = parsed.data;

  // Uniqueness pre-check (User table); claim collisions are fine, multiple
  // browsers can race to verify the same wallet.
  const existing = await prisma.user.findFirst({
    where: { OR: [{ mochimoAddress: hex }, { mochimoTag: tag }] },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "This wallet is already registered. Sign in instead." },
      { status: 409 },
    );
  }

  const claimToken = randomBytes(32).toString("hex");
  // crypto.randomInt is uniformly distributed and bounded — safe for this use.
  const challengeNanoMcm = randomInt(CHALLENGE_MIN, CHALLENGE_MAX + 1);
  const expiresAt = new Date(Date.now() + CLAIM_TTL_SEC * 1000);

  const claim = await prisma.walletClaim.create({
    data: { claimToken, hex, tag, challengeNanoMcm, expiresAt },
    select: { id: true, expiresAt: true },
  });

  // Best-effort housekeeping
  prisma.walletClaim
    .deleteMany({ where: { expiresAt: { lt: new Date() }, verifiedAt: null } })
    .catch(() => {});

  const challengeMcm = (challengeNanoMcm / 1e9).toFixed(9);
  return NextResponse.json({
    claimToken,
    claimId: claim.id,
    expiresAt: claim.expiresAt.toISOString(),
    ttlSeconds: CLAIM_TTL_SEC,
    challengeNanoMcm,
    challengeMcm,
    instructions: `Send EXACTLY ${challengeNanoMcm} nMCM (= ${challengeMcm} MCM) from wallet 0x${hex} within ${CLAIM_TTL_SEC} seconds. Any recipient (sending to yourself works).`,
  });
}
