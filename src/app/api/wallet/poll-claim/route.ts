import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findChallengePayment, getDepositAddress } from "@/lib/mochimo";

const BodySchema = z.object({ claimToken: z.string().min(32).max(128) });

// Server-side throttle: don't actually hit Mesh more often than this even if
// the client polls faster. A full check (mempool + recent blocks) takes a few
// seconds, so this sits above the client's ~5s poll interval.
const MIN_CHECK_INTERVAL_MS = 6000;

/**
 * Status check for a wallet-ownership claim. The client polls this every few
 * seconds while the user is supposed to be sending a tx from their wallet.
 *
 * Each call:
 *   1. Loads the claim.
 *   2. Returns immediately if already verified, consumed, or expired.
 *   3. Otherwise asks Mesh whether the challenge payment (exact amount, from
 *      the claimed wallet, to our deposit address) has appeared — mempool
 *      first, then confirmed transactions. Throttled by `lastCheckedAt` to
 *      avoid hammering the public Mesh node.
 *   4. Marks `verifiedAt` + saves the matching tx hash on success.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const claim = await prisma.walletClaim.findUnique({
    where: { claimToken: parsed.data.claimToken },
  });
  if (!claim) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  const now = Date.now();
  const remainingMs = Math.max(0, +claim.expiresAt - now);

  if (claim.consumedAt) {
    return NextResponse.json({
      status: "consumed",
      message: "Claim already used to create an account.",
    });
  }
  if (claim.verifiedAt) {
    return NextResponse.json({
      status: "verified",
      verifiedTxHash: claim.verifiedTxHash,
      hex: claim.hex,
      tag: claim.tag,
      remainingSeconds: Math.floor(remainingMs / 1000),
    });
  }
  if (remainingMs <= 0) {
    return NextResponse.json({ status: "expired" });
  }

  // Throttle Mesh calls
  const lastCheck = claim.lastCheckedAt ? +claim.lastCheckedAt : 0;
  const sinceLast = now - lastCheck;
  if (sinceLast < MIN_CHECK_INTERVAL_MS) {
    return NextResponse.json({
      status: "pending",
      remainingSeconds: Math.floor(remainingMs / 1000),
      nextCheckIn: Math.ceil((MIN_CHECK_INTERVAL_MS - sinceLast) / 1000),
    });
  }

  let deposit: { tag: string; hex: string };
  try {
    deposit = getDepositAddress();
  } catch (e) {
    console.error("[poll-claim] deposit address misconfigured:", e);
    return NextResponse.json(
      { error: "Registration wallet is not configured. Contact the admin." },
      { status: 500 },
    );
  }

  // Claim the throttle slot BEFORE the (multi-second) Mesh work, otherwise
  // polls that arrive while a check is in flight all sail past the throttle
  // and pile more load onto the public node.
  await prisma.walletClaim.update({
    where: { id: claim.id },
    data: { lastCheckedAt: new Date() },
  });

  const payment = await findChallengePayment({
    fromHex: claim.hex,
    toHex: deposit.hex,
    nanoMcm: claim.challengeNanoMcm,
  });

  if (payment) {
    await prisma.walletClaim.update({
      where: { id: claim.id },
      data: { verifiedAt: new Date(), verifiedTxHash: payment.hash },
    });
  }

  if (payment) {
    return NextResponse.json({
      status: "verified",
      verifiedTxHash: payment.hash,
      confirmed: payment.confirmed,
      hex: claim.hex,
      tag: claim.tag,
      remainingSeconds: Math.floor(remainingMs / 1000),
    });
  }

  return NextResponse.json({
    status: "pending",
    remainingSeconds: Math.floor(remainingMs / 1000),
  });
}
