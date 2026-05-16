import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { moderateContent } from "@/lib/ai-moderate";
import { awardPoints } from "@/lib/points";

const BodySchema = z.object({
  taskId: z.string().min(1),
  proofUrl: z.string().url().max(2048).optional().or(z.literal("")),
  proofText: z.string().max(4000).optional().or(z.literal("")),
});

const URL_PATTERNS: Record<string, RegExp> = {
  TWEET_URL: /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i,
  YOUTUBE_URL:
    /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[\w-]+|youtu\.be\/[\w-]+|youtube\.com\/shorts\/[\w-]+)/i,
  MEDIUM_URL:
    /^https?:\/\/(?:[\w-]+\.)?medium\.com\/[^\s]+|^https?:\/\/[\w-]+\.medium\.com\/[^\s]+/i,
};

const AUTO_APPROVE_THRESHOLD = 0.85;
const AUTO_REJECT_THRESHOLD = 0.2;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { taskId } = parsed.data;
  const proofUrl = parsed.data.proofUrl?.trim() || null;
  const proofText = parsed.data.proofText?.trim() || null;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task || !task.active) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Wallet required for any non-DAILY task with points (faucet payouts).
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { mochimoAddress: true, bannedAt: true },
  });
  if (me?.bannedAt) {
    return NextResponse.json({ error: "Account suspended." }, { status: 403 });
  }
  if (!me?.mochimoAddress && task.category !== "DAILY") {
    return NextResponse.json(
      { error: "Add your Mochimo wallet address first." },
      { status: 400 },
    );
  }

  // Validate proof format
  if (
    task.proofType === "TWEET_URL" ||
    task.proofType === "YOUTUBE_URL" ||
    task.proofType === "MEDIUM_URL"
  ) {
    if (!proofUrl) {
      return NextResponse.json({ error: "Proof URL required." }, { status: 400 });
    }
    const pat = URL_PATTERNS[task.proofType];
    if (!pat.test(proofUrl)) {
      return NextResponse.json(
        { error: `Invalid ${task.proofType.replace("_URL", "")} URL.` },
        { status: 400 },
      );
    }
  }
  if (task.proofType === "TEXT" && !proofText) {
    return NextResponse.json({ error: "Proof text required." }, { status: 400 });
  }

  // Per-user limits and cooldown
  const userSubs = await prisma.submission.findMany({
    where: {
      userId,
      taskId,
      status: { in: ["APPROVED", "AUTO_APPROVED", "PENDING", "FLAGGED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const completed = userSubs.filter(
    (s) => s.status === "APPROVED" || s.status === "AUTO_APPROVED",
  );
  if (task.maxPerUser != null && completed.length >= task.maxPerUser) {
    return NextResponse.json(
      { error: "You've reached the max completions for this task." },
      { status: 400 },
    );
  }
  if (task.cooldownHrs && completed.length > 0) {
    const last = +completed[0].createdAt;
    const cdMs = task.cooldownHrs * 3600 * 1000;
    if (Date.now() - last < cdMs) {
      return NextResponse.json(
        { error: "Task is on cooldown." },
        { status: 429 },
      );
    }
  }

  // Block duplicate proof URLs system-wide
  if (proofUrl) {
    const dupe = await prisma.submission.findFirst({
      where: { proofUrl, status: { in: ["APPROVED", "AUTO_APPROVED", "PENDING"] } },
      select: { id: true, userId: true },
    });
    if (dupe) {
      return NextResponse.json(
        { error: "This proof URL was already submitted." },
        { status: 409 },
      );
    }
  }

  // Decide initial status: AUTO tasks (e.g. daily check-in, referral) approve immediately;
  // other tasks go through AI moderation when applicable, otherwise PENDING.
  if (task.proofType === "AUTO" || task.proofType === "NONE" || task.autoApprove) {
    const submission = await prisma.submission.create({
      data: {
        userId,
        taskId,
        proofUrl,
        proofText,
        status: "AUTO_APPROVED",
        pointsAwarded: task.points,
      },
    });
    await awardPoints({
      userId,
      delta: task.points,
      reason: `task:${task.slug}`,
      submissionId: submission.id,
    });
    return NextResponse.json({
      ok: true,
      status: submission.status,
      pointsAwarded: submission.pointsAwarded,
    });
  }

  // AI moderation pass (best-effort; never blocks final user response on failure)
  const verdict = await moderateContent({
    taskTitle: task.title,
    taskDescription: task.description,
    proofUrl,
    proofText,
  }).catch(() => null);

  let status: "PENDING" | "AUTO_APPROVED" | "FLAGGED" = "PENDING";
  let pointsAwarded = 0;

  if (verdict) {
    if (verdict.verdict === "approve" && verdict.score >= AUTO_APPROVE_THRESHOLD) {
      status = "AUTO_APPROVED";
      pointsAwarded = task.points;
    } else if (verdict.verdict === "reject" || verdict.score <= AUTO_REJECT_THRESHOLD) {
      status = "FLAGGED";
    }
  }

  const submission = await prisma.submission.create({
    data: {
      userId,
      taskId,
      proofUrl,
      proofText,
      status,
      pointsAwarded,
      aiScore: verdict?.score ?? null,
      aiVerdict: verdict?.verdict ?? null,
      aiReason: verdict?.reason ?? null,
    },
  });

  if (status === "AUTO_APPROVED") {
    await awardPoints({
      userId,
      delta: pointsAwarded,
      reason: `task:${task.slug}`,
      submissionId: submission.id,
    });
  }

  return NextResponse.json({
    ok: true,
    status: submission.status,
    pointsAwarded: submission.pointsAwarded,
    ai: verdict,
  });
}
