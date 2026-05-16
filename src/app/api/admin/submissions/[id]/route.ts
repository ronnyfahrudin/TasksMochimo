import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { awardPoints } from "@/lib/points";

const BodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { action, reason } = parsed.data;

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { task: { select: { slug: true, points: true } } },
  });
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (submission.status === "APPROVED" || submission.status === "AUTO_APPROVED") {
    return NextResponse.json(
      { error: "Already approved" },
      { status: 409 },
    );
  }

  if (action === "approve") {
    await prisma.submission.update({
      where: { id },
      data: {
        status: "APPROVED",
        pointsAwarded: submission.task.points,
        reviewedById: session.user.id,
        reviewedAt: new Date(),
        rejectReason: null,
      },
    });
    await awardPoints({
      userId: submission.userId,
      delta: submission.task.points,
      reason: `task:${submission.task.slug}`,
      submissionId: submission.id,
    });
    return NextResponse.json({ ok: true, status: "APPROVED" });
  }

  await prisma.submission.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedById: session.user.id,
      reviewedAt: new Date(),
      rejectReason: reason ?? null,
    },
  });
  return NextResponse.json({ ok: true, status: "REJECTED" });
}
