import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordStrength } from "@/lib/password";

const usernameSchema = z
  .string({ required_error: "Username is required" })
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username must be at most 24 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and _")
  .transform((v) => v.toLowerCase());

const BodySchema = z
  .object({
    claimToken: z.string().min(32).max(128),
    username: usernameSchema,
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    confirmPassword: z.string(),
    referralCode: z.string().min(1).max(64).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

const SESSION_COOKIE = process.env.AUTH_URL?.startsWith("https://")
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

const SESSION_TTL_DAYS = 30;

/**
 * Finalize signup. Requires:
 *   - a `claimToken` that points to a WalletClaim marked verified (set by
 *     /api/wallet/poll-claim after observing a tx from the wallet on chain)
 *   - username + password + confirmPassword
 *
 * Hex + tag come from the WalletClaim — the client doesn't get to override
 * them at this step, which is what makes the mempool-watch flow trustworthy.
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
  const { claimToken, username, password } = parsed.data;

  const strength = passwordStrength(password);
  if (!strength.ok) {
    return NextResponse.json({ error: strength.reason, field: "password" }, { status: 400 });
  }

  const claim = await prisma.walletClaim.findUnique({
    where: { claimToken },
  });
  if (!claim) {
    return NextResponse.json(
      { error: "Wallet claim not found. Start over.", field: "claimToken" },
      { status: 404 },
    );
  }
  if (claim.consumedAt) {
    return NextResponse.json(
      { error: "Wallet claim already used.", field: "claimToken" },
      { status: 409 },
    );
  }
  if (+claim.expiresAt <= Date.now()) {
    return NextResponse.json(
      { error: "Wallet claim expired. Start over.", field: "claimToken" },
      { status: 410 },
    );
  }
  if (!claim.verifiedAt) {
    return NextResponse.json(
      {
        error: "Wallet not yet verified. Trigger a transaction from your wallet first.",
        field: "claimToken",
      },
      { status: 412 },
    );
  }

  const { hex, tag } = claim;

  // Uniqueness check (race-safe: also reject on Prisma P2002 below)
  const dupe = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { mochimoAddress: hex }, { mochimoTag: tag }],
    },
    select: { username: true, mochimoAddress: true, mochimoTag: true },
  });
  if (dupe) {
    let field = "username";
    let msg = "Username already taken.";
    if (dupe.mochimoAddress === hex) {
      field = "claimToken";
      msg = "This wallet is already registered. Sign in instead.";
    } else if (dupe.mochimoTag === tag) {
      field = "claimToken";
      msg = "This Mochimo tag is already registered.";
    }
    return NextResponse.json({ error: msg, field }, { status: 409 });
  }

  let referredById: string | undefined;
  if (parsed.data.referralCode) {
    const referrer = await prisma.user.findUnique({
      where: { referralCode: parsed.data.referralCode },
      select: { id: true },
    });
    referredById = referrer?.id;
  }

  const passwordHash = hashPassword(password);
  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { user } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username,
        passwordHash,
        mochimoAddress: hex,
        mochimoTag: tag,
        referredById,
        name: username,
      },
      select: { id: true, referralCode: true },
    });
    await tx.session.create({
      data: { sessionToken, userId: user.id, expires },
    });
    // Mark the claim consumed so it can't be reused.
    await tx.walletClaim.update({
      where: { id: claim.id },
      data: { consumedAt: new Date() },
    });
    return { user };
  });

  if (referredById) {
    const { awardPoints } = await import("@/lib/points");
    const refTask = await prisma.task.findUnique({
      where: { slug: "refer-friend" },
      select: { id: true, points: true },
    });
    if (refTask) {
      await prisma.submission.create({
        data: {
          userId: referredById,
          taskId: refTask.id,
          status: "AUTO_APPROVED",
          pointsAwarded: refTask.points,
          proofText: `Referred user ${user.id}`,
        },
      });
      await awardPoints({
        userId: referredById,
        delta: refTask.points,
        reason: `referral:${user.id}`,
      });
    }
  }

  const res = NextResponse.json({
    ok: true,
    userId: user.id,
    referralCode: user.referralCode,
    verifiedTxHash: claim.verifiedTxHash,
  });
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE.startsWith("__Secure-"),
    path: "/",
    expires,
  });
  return res;
}
