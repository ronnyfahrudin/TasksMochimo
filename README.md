# Mochimo Tasks

Quest board for the Mochimo ($MCM) quantum-resistant blockchain. Users
connect X (Twitter), add a Mochimo wallet address, and complete social /
content / referral / daily tasks to earn points and climb a monthly
leaderboard.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui ·
Prisma · Supabase Postgres · NextAuth v5 (Twitter OAuth 2.0) ·
Anthropic Claude / xAI Grok for content moderation · Vercel Cron.

---

## Quickstart

```bash
git init && git add -A && git commit -m "init"
pnpm install        # or npm install / yarn

cp .env.example .env.local
# fill in: DATABASE_URL, AUTH_SECRET, AUTH_TWITTER_ID / _SECRET,
# ANTHROPIC_API_KEY (or XAI_API_KEY), CRON_SECRET, ADMIN_TWITTER_HANDLES.

pnpm prisma migrate dev --name init
pnpm db:seed
pnpm dev
```

Open <http://localhost:3000> → sign in with X → add your Mochimo address
on the dashboard → complete tasks.

---

## Architecture map

```
src/
├── app/
│   ├── page.tsx                       # landing (hero + features)
│   ├── signin/page.tsx                # auth landing (?ref=CODE supported)
│   ├── dashboard/page.tsx             # points, wallet, referral, history
│   ├── tasks/page.tsx                 # grid with category tabs
│   ├── leaderboard/page.tsx           # monthly / all-time / last-month
│   ├── admin/page.tsx                 # admin home with KPIs
│   ├── admin/submissions/page.tsx     # moderation queue
│   ├── globals.css                    # dark theme + neon-green tokens
│   ├── layout.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── user/mochimo-address/route.ts
│       ├── tasks/submit/route.ts
│       ├── admin/submissions/[id]/route.ts
│       ├── moderate/route.ts          # admin-only manual AI re-mod
│       ├── referral/claim/route.ts
│       └── cron/reset-leaderboard/route.ts
├── components/
│   ├── ui/…                           # shadcn primitives
│   ├── navbar.tsx
│   ├── task-card.tsx                  # client: opens submit dialog
│   ├── mochimo-address-form.tsx
│   ├── referral-card.tsx
│   ├── referral-capture.tsx
│   └── review-row.tsx                 # admin row w/ approve/reject/remod
├── lib/
│   ├── prisma.ts
│   ├── auth.ts                        # NextAuth v5 (Twitter) + role
│   ├── mochimo.ts                     # base58 address validation
│   ├── points.ts                      # awardPoints() tx helper
│   ├── ai-moderate.ts                 # Claude / Grok moderator
│   ├── supabase.ts                    # service-role client
│   └── utils.ts                       # cn(), currentPeriod(), etc.
└── middleware.ts                      # /dashboard /tasks /admin guards
prisma/schema.prisma                   # User, Task, Submission, …, AppState
prisma/seed.ts                         # 9 starter tasks
supabase/functions/reset-leaderboard/  # alt cron via Supabase
vercel.json                            # Vercel Cron: 5 0 1 * *
```

---

## How features fit together

### Auth & sign-up flow

- `next-auth@5` with `@auth/prisma-adapter` (database sessions).
- The Twitter provider captures `twitterId` and `twitterHandle` in the
  `signIn` event ([src/lib/auth.ts](src/lib/auth.ts)). Handles in
  `ADMIN_TWITTER_HANDLES` are auto-promoted to `ADMIN`.
- After sign-in users land on `/dashboard`. If they came in via
  `/signin?ref=CODE`, `<ReferralCapture>` posts the code to
  `/api/referral/claim`, linking `referredById` exactly once.

### Mochimo wallet binding

[src/lib/mochimo.ts](src/lib/mochimo.ts) validates a 32–64-character
base58 string (Bitcoin/Mochimo Mesh alphabet — excludes `0`, `O`, `I`,
`l`). The `/api/user/mochimo-address` route:

1. Rejects duplicates across accounts.
2. Saves the address.
3. **On the user's first wallet save**, if they were referred, credits the
   referrer a 100-pt `AUTO_APPROVED` submission to the `refer-friend`
   task — so the bounty only fires for serious sign-ups.

### Task submission + AI moderation

`POST /api/tasks/submit` (see
[src/app/api/tasks/submit/route.ts](src/app/api/tasks/submit/route.ts)):

1. Auth + ban check.
2. Wallet required for non-DAILY tasks.
3. Validates proof URL pattern (tweet / youtube / medium regexes).
4. Enforces `maxPerUser` and `cooldownHrs`.
5. Rejects duplicate proof URLs system-wide.
6. `AUTO`/`NONE` or `autoApprove` tasks → `AUTO_APPROVED` + points.
7. Otherwise: calls `moderateContent()` with the proof.
   - `verdict=approve && score >= 0.85` → auto-approve.
   - `verdict=reject || score <= 0.2` → `FLAGGED` (admin reviews).
   - Otherwise → `PENDING` (admin reviews).
8. Atomic `awardPoints()` increments `points` *and* `lifetimePoints` and
   writes a `PointsLedger` row tagged with the current `YYYY-MM` period.

Moderator prompt is in [src/lib/ai-moderate.ts](src/lib/ai-moderate.ts).
It defaults to Claude (Haiku 4.5) and falls back to xAI Grok. With *no*
key configured it returns `verdict: "review"` so every submission lands
in the admin queue (never silently approved).

### Admin moderation

`/admin/submissions` lists `PENDING` or `FLAGGED` queues. Each row
([src/components/review-row.tsx](src/components/review-row.tsx))
exposes: open proof URL, view AI verdict + score, **Re-moderate**
button (re-runs the AI), **Approve**, and **Reject (with reason)**.
Decisions hit `PATCH /api/admin/submissions/[id]`, which uses a Prisma
transaction to update the submission and call `awardPoints()`.

### Referral system

Each user has a permanent `referralCode` (cuid). The dashboard renders
`{NEXT_PUBLIC_APP_URL}/signin?ref={code}`. Sign-in preserves `ref`
through the OAuth redirect to `/dashboard?ref=…`, where
`<ReferralCapture>` links the relationship. Points are only awarded once
the referred user binds a Mochimo wallet (anti-bot).

### Monthly leaderboard reset

[src/app/api/cron/reset-leaderboard/route.ts](src/app/api/cron/reset-leaderboard/route.ts):

- Authenticated via `Authorization: Bearer ${CRON_SECRET}`.
- Snapshots every user with `points > 0` into `LeaderboardSnapshot`
  (period = the month being closed), then zeroes `User.points` in a
  single transaction. `lifetimePoints` is preserved.
- Idempotent: re-running for the same period is a no-op.

Two ways to schedule:

| Option | Where to configure |
| --- | --- |
| **Vercel Cron** | `vercel.json` already wires `5 0 1 * *` → `/api/cron/reset-leaderboard`. Vercel automatically attaches the `CRON_SECRET` header in production. |
| **Supabase Edge Function** | Deploy [supabase/functions/reset-leaderboard/index.ts](supabase/functions/reset-leaderboard/index.ts), set `APP_URL` and `CRON_SECRET` env vars in the Supabase project, then add a Cron schedule from the dashboard. |

### Dark neon-green theme

Always-dark CSS variables in
[src/app/globals.css](src/app/globals.css), Tailwind tokens in
[tailwind.config.ts](tailwind.config.ts). Key utilities:

- `text-glow` — neon text shadow.
- `gradient-text-neon` — three-stop gradient text.
- `bg-grid` — subtle grid backdrop.
- `shadow-neon` / `shadow-neon-sm` / `animate-pulse-neon`.

---

## Common ops

```bash
# Manually trigger a reset (e.g. for testing)
curl -X POST http://localhost:3000/api/cron/reset-leaderboard \
  -H "Authorization: Bearer $CRON_SECRET"

# Promote an admin by Twitter handle
echo 'ADMIN_TWITTER_HANDLES="myhandle,otherhandle"' >> .env.local
# (or update role manually:)
pnpm prisma studio  # User → role: ADMIN

# Re-seed tasks (idempotent upsert by slug)
pnpm db:seed
```

---

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` is server-only and never exposed to the
  client. `lib/supabase.ts` uses it for admin operations only.
- All admin routes are gated in `middleware.ts` *and* re-checked in each
  API/page handler (defense in depth).
- Duplicate proof URLs are rejected server-side so the same tweet can't
  be farmed across accounts.
- `bannedAt` short-circuits `POST /api/tasks/submit` before any work.
- The AI moderator is a heuristic — never trust it for final approval of
  >100-pt tasks; default to manual review.
