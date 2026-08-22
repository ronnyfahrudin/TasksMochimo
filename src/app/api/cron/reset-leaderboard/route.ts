import { NextResponse } from "next/server";
import { cronSecret } from "@/infrastructure/config/app-config";
import { useCases } from "@/infrastructure/container";
import { toErrorResponse } from "@/interface/http/error-mapper";

/**
 * Monthly leaderboard reset — Vercel Cron ("5 0 1 * *" in vercel.json) sets
 * the Authorization header; manual runs must supply the same bearer token.
 */
export async function GET(req: Request) {
  // Fail CLOSED. The previous `if (secret && …)` meant an unset CRON_SECRET
  // disabled the check entirely, leaving a public URL that zeroes every user's
  // monthly points.
  const secret = cronSecret();
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the reset");
    return NextResponse.json(
      { error: "Cron is not configured on this deployment." },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await useCases.resetLeaderboard().execute());
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Supabase Edge Functions invoke with POST by default.
export const POST = GET;
