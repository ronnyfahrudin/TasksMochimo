// Supabase Edge Function alternative to Vercel Cron.
// Deploy with: supabase functions deploy reset-leaderboard
// Schedule from the Supabase dashboard → Cron → invoke this function with
// schedule "5 0 1 * *" (00:05 UTC on the 1st of every month).
//
// It simply forwards to /api/cron/reset-leaderboard on the Next.js app,
// passing CRON_SECRET. This keeps the reset logic in one place (Prisma-aware)
// and avoids duplicating it in PL/pgSQL or Deno.

// @ts-expect-error - Deno globals are present at runtime in Supabase Functions
const APP_URL = Deno.env.get("APP_URL");
// @ts-expect-error
const CRON_SECRET = Deno.env.get("CRON_SECRET");

// @ts-expect-error
Deno.serve(async () => {
  if (!APP_URL || !CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Missing env" }), { status: 500 });
  }
  const r = await fetch(`${APP_URL}/api/cron/reset-leaderboard`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
});
