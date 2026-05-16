import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  mochimoHexSchema,
  mochimoTagSchema,
  verifyMochimoAddressOnchain,
} from "@/lib/mochimo";

const BodySchema = z.object({
  hex: mochimoHexSchema,
  tag: mochimoTagSchema,
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${issue?.path?.join(".")}: ${issue?.message ?? "Invalid body"}` },
      { status: 400 },
    );
  }
  const { hex, tag } = parsed.data;

  // Mesh verify
  const verify = await verifyMochimoAddressOnchain(`0x${hex}`);
  if (verify.ok === false) {
    return NextResponse.json(
      { error: `Hex rejected by Mesh: ${verify.reason}` },
      { status: 400 },
    );
  }

  // Duplicate check (excluding self)
  const dupe = await prisma.user.findFirst({
    where: {
      OR: [{ mochimoAddress: hex }, { mochimoTag: tag }],
      NOT: { id: session.user.id },
    },
    select: { id: true },
  });
  if (dupe) {
    return NextResponse.json(
      { error: "This wallet is already linked to another account." },
      { status: 409 },
    );
  }

  const previous = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { mochimoAddress: true, referredById: true },
  });
  const isFirstLink = !previous?.mochimoAddress;

  await prisma.user.update({
    where: { id: session.user.id },
    data: { mochimoAddress: hex, mochimoTag: tag },
  });

  // First-link referral bonus (matches wallet-signup logic for Twitter-first users)
  if (isFirstLink && previous?.referredById) {
    const { awardPoints } = await import("@/lib/points");
    const refTask = await prisma.task.findUnique({
      where: { slug: "refer-friend" },
      select: { id: true, points: true },
    });
    if (refTask) {
      await prisma.submission.create({
        data: {
          userId: previous.referredById,
          taskId: refTask.id,
          status: "AUTO_APPROVED",
          pointsAwarded: refTask.points,
          proofText: `Referred user ${session.user.id}`,
        },
      });
      await awardPoints({
        userId: previous.referredById,
        delta: refTask.points,
        reason: `referral:${session.user.id}`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    hex,
    tag,
    meshVerified: verify.ok === true,
    balanceMcm: verify.ok === true ? verify.balanceMcm : undefined,
    meshNote: verify.ok === "unknown" ? verify.reason : undefined,
  });
}
