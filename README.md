# Mochimo Tasks

Quest board for the Mochimo ($MCM) quantum-resistant blockchain. Users sign up
with their Mochimo wallet (verified on-chain via the Mochimo Mesh API), set a
username + password, and complete social / content / referral / daily tasks to
earn points and climb a monthly leaderboard. X (Twitter) connect is optional —
needed only for social tasks.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · shadcn/ui ·
Prisma · PostgreSQL (local or Supabase) · Auth.js v5 (custom credentials +
optional Twitter OAuth 2.0) · scrypt password hashing · Mochimo Mesh API
(Rosetta) · Anthropic Claude / xAI Grok for content moderation · Vercel Cron
or Supabase pg_cron.

---

## Quickstart (local PostgreSQL)

```bash
# 1. Install
npm install

# 2. Create local Postgres role + DB (one-time)
sudo -u postgres psql <<'SQL'
ALTER DATABASE template1 REFRESH COLLATION VERSION;  -- if you hit collation mismatch
CREATE USER mochimo WITH PASSWORD 'mochimo123' CREATEDB;
CREATE DATABASE mochimo_tasks OWNER mochimo;
GRANT ALL PRIVILEGES ON DATABASE mochimo_tasks TO mochimo;
SQL

# 3. Env
cp .env.example .env.local
# .env.local already points at the local DB; just fill in AUTH_SECRET:
echo "AUTH_SECRET=\"$(openssl rand -base64 32)\"" >> .env.local

# Prisma CLI reads .env, Next.js reads .env.local — symlink them:
ln -sf .env.local .env

# 4. Apply schema + seed tasks
npx prisma migrate dev --name init
npm run db:seed

# 5. Run
npm run dev
```

Open <http://localhost:3000>, click **Sign up with Mochimo wallet**, then walk
the three steps: paste tag + hex → send the challenge amount from your wallet
(auto-detected in the Mesh mempool) → pick username + password. Ownership of
the wallet is proven on-chain before the account is created.

---

## Sign-up & sign-in flow

The app supports **two** sign-in methods that share the same User table:

### Wallet-first sign-up with mempool proof-of-ownership

Inspired by how the Mochimo forum verifies wallet registrations, `/signup` is
a **three-step state machine** that proves the user controls the wallet before
the account is created — not just that the address exists on chain.

**Step 1 — open a claim.** User pastes:
- **Mochimo account tag** — base58 form (display, from
  [Mochiscan](https://mochiscan.org/))
- **Hex address** — 40 hex chars, with optional `0x`

`POST /api/wallet/start-claim` creates a `WalletClaim` row with a random
`claimToken`, hex, tag, a random **amount challenge** (`challengeNanoMcm`,
100–999,999 nMCM), and a 60-second `expiresAt` (`CLAIM_TTL_SEC`). The form
switches into **verifying** state.

**Step 2 — verify via mempool watch.** The form displays the wallet hex, the
challenge amount (click-to-copy), a countdown, and instructions:

> *Send EXACTLY 483,712 nMCM (= 0.000483712 MCM) from this wallet within 60
> seconds. Any recipient — sending to yourself works. We'll auto-detect it
> via the Mochimo Mesh mempool.*

The client polls `POST /api/wallet/poll-claim` every 5 seconds. Each call:
1. Server-side throttle (`MIN_CHECK_INTERVAL_MS = 3s`) so concurrent users
   don't hammer the public Mesh node.
2. `checkMempoolForAddress()` in [src/lib/mochimo.ts](src/lib/mochimo.ts)
   fetches `/mempool` (list of pending tx hashes), then iterates
   `/mempool/transaction` for each, comparing every operation's
   `account.address` (lowercased) against the claim's hex with `0x` prefix
   **and** the operation's absolute amount against `challengeNanoMcm` — so an
   unrelated pending tx from the same wallet can't satisfy the claim.
3. First match → `WalletClaim.verifiedAt` set + `verifiedTxHash` saved.

When the poll response is `status: "verified"`, the form swaps to
**Step 3 — set credentials**: username + password + confirm. Submit posts to
`POST /api/auth/wallet-signup` with the `claimToken`; hex + tag are read
from the verified claim (the client can't override them at this point),
which is what makes the flow trustworthy. The claim is marked
`consumedAt` so it can't be replayed.

`POST /api/auth/credentials-signin` (separate from signup) verifies username
+ password via `scryptSync` in constant time (also runs against a
placeholder hash on unknown usernames so timing can't enumerate users),
creates a `Session` row, and sets the Auth.js `authjs.session-token` cookie.

### Twitter OAuth 2.0 (optional)

If `AUTH_TWITTER_ID/SECRET` are set, `/signin` also exposes a "Continue with
X" button. Required for social tasks that reference a Twitter handle (admin
allow-list via `ADMIN_TWITTER_HANDLES` only works for Twitter sign-in).

---

## Mochimo wallet binding (Mesh-verified)

[src/lib/mochimo.ts](src/lib/mochimo.ts) handles both address formats:

| Form | Example | Source |
| --- | --- | --- |
| Hex (canonical) | `0xd9c0c06c5383eb5cc0159f618101003d3b7abe84` | sent to Mesh API |
| Base58 tag | `226qEKxKSKCXMVtmBFVPKAz7H5aVjgH` | display on dashboard / leaderboard |

`verifyMochimoAddressOnchain()` POSTs the hex to
`{MOCHIMO_MESH_URL}/account/balance` (Rosetta 1.4.13). It returns:

- `ok: true` — Mesh accepted the address (with balance / block index)
- `ok: false` — Mesh explicitly rejected the format (sign-up blocked)
- `ok: "unknown"` — network/timeout → account still created, flagged for
  admin review (soft-fail so flaky upstream never locks users out)

Code 4 "Account not found" is treated as **valid format, zero balance** — a
fresh wallet may exist on Mochiscan but have no on-chain history yet.

---

## Tasks & duplicate-tweet protection

Seeded by [prisma/seed.ts](prisma/seed.ts) — **16 starter tasks** across
SOCIAL, CONTENT, REFERRAL, and DAILY categories. Daily Twitter tasks
(check-in, like, retweet, quote) reset every 20 hours per user.

### Submit flow

`POST /api/tasks/submit` in
[src/app/api/tasks/submit/route.ts](src/app/api/tasks/submit/route.ts):

1. Auth + ban check.
2. Wallet required for non-DAILY tasks.
3. **Tweet URL normalization**: any submission shaped like a tweet URL
   (x.com, twitter.com, mobile, with tracking params, `/photo/1` suffix,
   etc.) is run through `extractTweetId()` in
   [src/lib/twitter.ts](src/lib/twitter.ts) and stored in canonical form
   `https://x.com/{user}/status/{id}`.
4. **Tweet-ID dedup across the whole system**, including `FLAGGED` status —
   the same tweet can never be claimed twice, by anyone, in any format.
5. URL pattern validation (tweet / youtube / medium regexes).
6. `maxPerUser` and `cooldownHrs` enforcement (DAILY tasks → 20h cooldown).
7. AUTO/NONE tasks (daily check-in, referral credit) → instant
   `AUTO_APPROVED` + points awarded.
8. Otherwise: AI moderation → `auto-approve >= 0.85`, `flag <= 0.2`,
   otherwise PENDING for admin.
9. Atomic `awardPoints()` increments `points` *and* `lifetimePoints` and
   writes a `PointsLedger` row tagged with `YYYY-MM`.

### Admin moderation

`/admin/submissions` lists PENDING / FLAGGED. Each row
([src/components/review-row.tsx](src/components/review-row.tsx)) shows the
AI verdict + score and offers **Re-moderate**, **Approve**, **Reject**.

---

## Monthly leaderboard reset

[src/app/api/cron/reset-leaderboard/route.ts](src/app/api/cron/reset-leaderboard/route.ts):

- Auth via `Authorization: Bearer ${CRON_SECRET}`
- Snapshots `User.points > 0` into `LeaderboardSnapshot` (period = month
  being closed), then zeroes `User.points` in one transaction.
  `lifetimePoints` is preserved.
- Idempotent — re-running for the same period is a no-op.

Schedule it with whichever you prefer:

| Option | Config |
| --- | --- |
| **Vercel Cron** | `vercel.json` already wires `5 0 1 * *`. Vercel attaches `CRON_SECRET` automatically in prod. |
| **Supabase pg_cron** | `select cron.schedule('reset-leaderboard', '5 0 1 * *', $$ select net.http_post(url := '<APP_URL>/api/cron/reset-leaderboard', headers := '{"Authorization":"Bearer <CRON_SECRET>"}'::jsonb); $$);` |
| **Supabase Edge Function** | Deploy [supabase/functions/reset-leaderboard/index.ts](supabase/functions/reset-leaderboard/index.ts) then add a Cron schedule in the Supabase dashboard. |
| **Netlify Scheduled Functions** | A 5-line function in `netlify/functions/` calling the API works; minimum interval is 5 minutes. |

---

## Architecture map

```
src/
├── app/
│   ├── page.tsx                          # landing (hero + features)
│   ├── signup/page.tsx                   # wallet-first 3-step signup
│   ├── signin/page.tsx                   # username+password + optional X
│   ├── dashboard/page.tsx                # points, wallet (tag + hex), referral, history
│   ├── tasks/page.tsx                    # category tabs + stat banner
│   ├── leaderboard/page.tsx              # monthly / all-time / last-month
│   ├── admin/page.tsx                    # KPIs
│   ├── admin/submissions/page.tsx        # moderation queue
│   ├── globals.css                       # dark neon-green theme
│   ├── layout.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts   # NextAuth handlers (for Twitter OAuth)
│       ├── auth/wallet-signup/route.ts   # finalize signup (consumes verified claim)
│       ├── auth/credentials-signin/route.ts # username+password signin
│       ├── wallet/start-claim/route.ts   # open WalletClaim (hex+tag → claimToken)
│       ├── wallet/poll-claim/route.ts    # mempool watch poller
│       ├── user/mochimo-address/route.ts # update wallet for Twitter users
│       ├── tasks/submit/route.ts         # submit proof + dedup + AI mod
│       ├── admin/submissions/[id]/route.ts # approve / reject
│       ├── moderate/route.ts             # admin manual AI re-mod
│       ├── referral/claim/route.ts
│       └── cron/reset-leaderboard/route.ts
├── components/
│   ├── ui/…                              # shadcn primitives
│   ├── navbar.tsx
│   ├── task-card.tsx                     # client: Done badge, cooldown countdown, one-click for NONE/AUTO
│   ├── wallet-signup-form.tsx            # 3-step: wallet → mempool watch → credentials
│   ├── credentials-signin-form.tsx       # username+password signin
│   ├── mochimo-address-form.tsx          # dashboard tag+hex form
│   ├── referral-card.tsx
│   ├── referral-capture.tsx
│   └── review-row.tsx
├── lib/
│   ├── prisma.ts
│   ├── auth.ts                           # Auth.js v5 (Twitter) + role helpers
│   ├── password.ts                       # scrypt hash/verify (node:crypto)
│   ├── mochimo.ts                        # tag/hex schemas + Mesh verifier
│   ├── twitter.ts                        # tweet ID extract + canonical URL
│   ├── points.ts                         # awardPoints() tx helper
│   ├── ai-moderate.ts                    # Claude/Grok moderator
│   ├── supabase.ts                       # service-role client (optional)
│   └── utils.ts                          # cn(), currentPeriod(), etc.
├── middleware.ts.bak                     # disabled — Prisma adapter incompatible with Edge
prisma/schema.prisma                      # User (username/passwordHash/mochimoAddress/mochimoTag), Task, Submission, …
prisma/seed.ts                            # 16 starter tasks
supabase/functions/reset-leaderboard/     # alt cron via Supabase
vercel.json                               # Vercel Cron: 5 0 1 * *
netlify.toml                              # Netlify build config
```

Note: `middleware.ts` is intentionally renamed to `.bak`. NextAuth middleware
with the Prisma adapter runs on Edge and can't query the DB; pages already
guard with their own `auth()` + `redirect()` so the middleware was redundant.

---

## Dark neon-green theme

Always-dark HSL tokens in [src/app/globals.css](src/app/globals.css), Tailwind
extensions in [tailwind.config.ts](tailwind.config.ts):

- `text-glow` — neon text shadow
- `gradient-text-neon` — three-stop gradient
- `bg-grid` — subtle grid backdrop
- `shadow-neon` / `shadow-neon-sm` / `animate-pulse-neon`

---

## Common ops

```bash
# Reset everything (drops DB, re-applies migrations, re-seeds)
npx prisma migrate reset --force

# Trigger leaderboard reset manually (testing)
curl -X POST http://localhost:3000/api/cron/reset-leaderboard \
  -H "Authorization: Bearer $CRON_SECRET"

# Promote a credentials user to admin
npx prisma studio  # User → set role: ADMIN

# Re-seed tasks (idempotent upsert by slug)
npm run db:seed

# Inspect DB
npx prisma studio
# or
PGPASSWORD=mochimo123 psql -h localhost -U mochimo -d mochimo_tasks
```

---

## Security notes

- **Password hashing** is scrypt with OWASP-recommended params. Format is
  `scrypt$N$r$p$saltHex$hashHex` so params can be rotated without breaking
  existing logins. Verify path always runs against a placeholder hash on
  unknown usernames so timing won't leak account existence.
- **Cookies** are HttpOnly + SameSite=Lax. In production (`AUTH_URL` starts
  with `https://`) they get the `__Secure-` prefix.
- **`SUPABASE_SERVICE_ROLE_KEY`** is server-only — never exposed to the
  browser. `lib/supabase.ts` uses it for admin operations only.
- **Admin routes** are checked in every API/page handler (no middleware).
- **Duplicate proof URLs** rejected by tweet-ID across all statuses
  including FLAGGED, so a previously-flagged tweet can't be recycled.
- **`bannedAt`** short-circuits `POST /api/tasks/submit` before any work.
- The AI moderator is a heuristic — don't trust it as final approval for
  high-value tasks (>100 pts); rely on manual review.

### Known prototype gaps

- **Wallet ownership IS proven** as of the mempool-watch flow above — the
  user must send a tx with the exact random challenge amount from the wallet
  inside the 60-second claim window, so a pre-existing pending tx can't
  satisfy the claim. The remaining friction is the window itself: 60 seconds
  is tight for someone who still has to open their wallet software. Raise
  `CLAIM_TTL_SEC` in
  [src/app/api/wallet/start-claim/route.ts](src/app/api/wallet/start-claim/route.ts)
  if users report timeouts — the amount challenge, not the short window, is
  what carries the security.
- **Tweet freshness** isn't verified — daily tasks accept any tweet from
  @mochimo's history, not just today's. Needs X API integration to check
  `created_at`.
- **Username uniqueness** is case-folded server-side but the same person
  can sign up multiple times with different usernames + different wallets.
  Adequate for a faucet program; tighten if needed.
