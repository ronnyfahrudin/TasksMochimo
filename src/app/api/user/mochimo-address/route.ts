import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  mochimoAddressSchema,
  normalizeMochimoAddress,
} from "@/lib/mochimo";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = mochimoAddressSchema.safeParse(body.address);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid address" },
      { status: 400 },
    );
  }

  const address = normalizeMochimoAddress(parsed.data);

  // Disallow address collisions (same wallet across multiple accounts).
  const collision = await prisma.user.findFirst({
    where: { mochimoAddress: address, NOT: { id: session.user.id } },
    select: { id: true },
  });
  if (collision) {
    return NextResponse.json(
      { error: "This address is already linked to another account." },
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
    data: { mochimoAddress: address },
  });

  // If this is the user's first time setting an address AND they were referred,
  // credit the referrer the one-time referral bonus.
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

  return NextResponse.json({ ok: true, address });
}
