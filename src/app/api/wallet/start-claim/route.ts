import { NextResponse } from "next/server";
import { randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  base58TagToHex,
  getDepositAddress,
  mochimoHexSchema,
  mochimoTagSchema,
} from "@/lib/mochimo";

const CLAIM_TTL_SEC = 15 * 60; // 15 minutes — enough time to open a wallet
const CHALLENGE_MIN = 100;
const CHALLENGE_MAX = 999_999; // up to 999_999 nMCM (~0.000999999 MCM)

const BodySchema = z.object({
  hex: mochimoHexSchema,
  tag: mochimoTagSchema,
});

/** nMCM → MCM string, e.g. 213972 → "0.000213972" */
function toMcm(nano: number): string {
  return (nano / 1e9).toFixed(9);
}

/**
 * Pick a challenge amount not currently in use by another live claim, so two
 * users can never be verified by the same payment.
 */
async function uniqueChallenge(): Promise<number> {
  const active = await prisma.walletClaim.findMany({
    where: { expiresAt: { gt: new Date() }, consumedAt: null },
    select: { challengeNanoMcm: true },
  });
  const taken = new Set(active.map((c) => c.challengeNanoMcm));
  for (let i = 0; i < 50; i++) {
    // crypto.randomInt is uniformly distributed and bounded — safe for this use.
    const n = randomInt(CHALLENGE_MIN, CHALLENGE_MAX + 1);
    if (!taken.has(n)) return n;
  }
  throw new Error("Could not allocate a unique challenge amount");
}

/**
 * Open a wallet-ownership claim. The client posts the wallet hex + display
 * tag; we issue a `claimToken`, a random challenge amount, and a 15-minute
 * window. The user proves ownership by sending EXACTLY that amount from the
 * claimed wallet to our deposit address — a payment only the key holder can
 * make. /api/wallet/poll-claim watches for it.
 *
 * If the hex is already registered to an existing User, we reject early
 * (409) — no point letting them pay to verify a wallet they can't claim.
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

  // The tag decodes to the hex — mismatched fields mean the user pasted two
  // different wallets, which would make the payment unverifiable.
  const decoded = base58TagToHex(tag);
  if (decoded && decoded !== hex) {
    return NextResponse.json(
      {
        error: "Tag and hex belong to different wallets. Copy both from the same address.",
        field: "hex",
      },
      { status: 400 },
    );
  }

  let deposit: { tag: string; hex: string };
  try {
    deposit = getDepositAddress();
  } catch (e) {
    console.error("[start-claim] deposit address misconfigured:", e);
    return NextResponse.json(
      { error: "Registration wallet is not configured. Contact the admin." },
      { status: 500 },
    );
  }

  if (deposit.hex === hex) {
    return NextResponse.json(
      { error: "That is the registration wallet, not yours.", field: "hex" },
      { status: 400 },
    );
  }

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
  const challengeNanoMcm = await uniqueChallenge();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_SEC * 1000);

  const claim = await prisma.walletClaim.create({
    data: { claimToken, hex, tag, challengeNanoMcm, expiresAt },
    select: { id: true, expiresAt: true },
  });

  // Best-effort housekeeping
  prisma.walletClaim
    .deleteMany({ where: { expiresAt: { lt: new Date() }, verifiedAt: null } })
    .catch(() => {});

  const challengeMcm = toMcm(challengeNanoMcm);
  return NextResponse.json({
    claimToken,
    claimId: claim.id,
    expiresAt: claim.expiresAt.toISOString(),
    ttlSeconds: CLAIM_TTL_SEC,
    challengeMcm,
    challengeNanoMcm,
    depositTag: deposit.tag,
    depositHex: deposit.hex,
    instructions: `Send EXACTLY ${challengeMcm} MCM from wallet 0x${hex} to ${deposit.tag} within ${CLAIM_TTL_SEC / 60} minutes.`,
  });
}
