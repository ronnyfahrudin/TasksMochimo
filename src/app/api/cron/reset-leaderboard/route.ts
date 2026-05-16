import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentPeriod, previousPeriod } from "@/lib/utils";

/**
 * Monthly leaderboard reset.
 *
 * Scheduled by Vercel Cron (see vercel.json) — "5 0 1 * *" runs 00:05 UTC on
 * the 1st of every month. Vercel sets the Authorization header to "Bearer
 * $CRON_SECRET" automatically. Manual invocation must include the same header.
 *
 * Steps (all in a transaction):
 *   1. Take a leaderboard snapshot of the previous period using user.points.
 *   2. Zero out every user's `points` field (lifetimePoints is preserved).
 *   3. Advance AppState.currentPeriod to the new YYYY-MM.
 *
 * Idempotent: re-running on the same period is a no-op (snapshot upsert).
 */
export async function GET(req: Request) {
  const authz = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authz !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runReset();
}

// Also allow POST (Supabase Edge Functions invoke with POST by default).
export const POST = GET;

async function runReset() {
  const newPeriod = currentPeriod();
  const closingPeriod = previousPeriod(); // the month we're closing out

  const state = await prisma.appState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, currentPeriod: newPeriod },
  });

  if (state.currentPeriod === newPeriod && state.lastResetAt) {
    return NextResponse.json({
      ok: true,
      message: "Already reset for this period",
      period: newPeriod,
    });
  }

  // Snapshot top users (with points > 0) ranked by descending points.
  const topUsers = await prisma.user.findMany({
    where: { points: { gt: 0 } },
    orderBy: [{ points: "desc" }, { updatedAt: "asc" }],
    select: { id: true, points: true, twitterHandle: true },
  });

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < topUsers.length; i++) {
      const u = topUsers[i];
      await tx.leaderboardSnapshot.upsert({
        where: { period_userId: { period: closingPeriod, userId: u.id } },
        update: { rank: i + 1, points: u.points, twitterHandle: u.twitterHandle },
        create: {
          period: closingPeriod,
          userId: u.id,
          rank: i + 1,
          points: u.points,
          twitterHandle: u.twitterHandle,
        },
      });
    }

    await tx.user.updateMany({
      where: { points: { gt: 0 } },
      data: { points: 0 },
    });

    await tx.appState.update({
      where: { id: 1 },
      data: { currentPeriod: newPeriod, lastResetAt: new Date() },
    });
  });

  return NextResponse.json({
    ok: true,
    closedPeriod: closingPeriod,
    newPeriod,
    snapshotted: topUsers.length,
  });
}
