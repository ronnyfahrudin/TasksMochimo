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
the three steps: paste tag + hex → send the exact challenge amount to the
deposit address (auto-detected on chain) → pick username + password. Ownership
of the wallet is proven on-chain before the account is created.

Set `MOCHIMO_DEPOSIT_TAG` to a wallet **you** control before letting anyone
sign up — that address receives the registration payments.

Requires Node 18.18+ (Next.js 15 refuses to start on 18.17).

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
100–999,999 nMCM, unique among live claims), and a 15-minute `expiresAt`
(`CLAIM_TTL_SEC`). It also rejects a tag+hex pair that doesn't belong to the
same wallet, and returns the deposit address. The form switches into
**verifying** state.

**Step 2 — pay the challenge.** The form shows the amount in MCM
(auto-copied to the clipboard), the deposit address, and a countdown:

> *Send EXACTLY 0.000483712 MCM to `226qEKxKSKCXMVtmBFVPKAz7H5aVjgH`.*

Only the key holder can make that payment, which is what proves ownership —
Mochimo's WOTS+ keys are one-time-use, so wallets don't offer "sign this
message" the way Ethereum does; a transaction is the available proof.

The client polls `POST /api/wallet/poll-claim` every 5 seconds. Each call:
1. Server-side throttle (`MIN_CHECK_INTERVAL_MS = 6s`), claimed *before* the
   Mesh work starts so overlapping polls don't stack up on the public node.
2. `findChallengePayment()` in [MochimoMeshGateway](src/infrastructure/mesh/mochimo-mesh-gateway.ts) looks
   for a single transaction carrying **both** legs: a source operation from
   the claimed wallet (negative amount) **and** a destination operation to the
   deposit address for exactly `challengeNanoMcm`. It checks `/mempool` first
   (visible seconds after the user hits send), then the last
   `CONFIRMED_BLOCK_LOOKBACK` blocks via `/block` for a payment that was
   already mined.
3. First match → `WalletClaim.verifiedAt` set + `verifiedTxHash` saved.

Why the exact amount matters: the fee is folded into the source leg
(`-200728034` for a `733035` transfer plus `500` fee), so only the
**destination** leg carries the challenge value verbatim. Matching both legs
means neither an unrelated payment to us nor an unrelated spend from the
user's wallet can satisfy a claim on its own.

`/search/transactions` would be the obvious way to find confirmed payments,
but the public node takes 17s+ for a 5-row page and times out near 50 — hence
the block scan, where `/block` answers in well under a second.

When the poll response is `status: "verified"`, the form swaps to
**Step 3 — set credentials**: username + password + confirm. Submit posts to
`POST /api/auth/wallet-signup` with the `claimToken`; hex + tag are read
from the verified claim (the client can't override them at this point),
which is what makes the flow trustworthy. The claim is marked
`consumedAt` so it can't be replayed.

`POST /api/auth/credentials-signin` → [SignInWithCredentials](src/application/identity/sign-in-with-credentials.ts) verifies username
+ password via [ScryptPasswordHasher](src/infrastructure/crypto/scrypt-password-hasher.ts) in constant time (also runs against a
placeholder hash on unknown usernames so timing can't enumerate users),
creates a `Session` row, and sets the Auth.js `authjs.session-token` cookie.

### Free public-testing mode (`FREE_SIGNUP_MODE=on`)

For an open beta where testers shouldn't have to spend MCM (or own a real
wallet at all), set `FREE_SIGNUP_MODE=on`. `/api/wallet/start-claim` then
skips the deposit wallet entirely, creates the `WalletClaim` already
`verifiedAt`, stamps `verifiedTxHash = "FREE_SIGNUP_NO_PAYMENT"`, and returns
`freeSignup: true`. The form jumps straight from step 1 to step 3, and both
step 1 and step 3 show a yellow **"Free public testing — wallet ownership is
not verified"** banner. Nothing else in the app changes: `/wallet-signup`,
the poller, tasks, and points all behave as they do after a real payment.

The trade-off is total: **anyone can register anyone's wallet address**, and
`MOCHIMO_DEPOSIT_TAG` is no longer required. Only turn it on for a throwaway
beta database whose accounts and points you are willing to wipe. Leaving the
variable unset keeps the paid-challenge proof of ownership (the default).

### Twitter OAuth 2.0 (optional)

If `AUTH_TWITTER_ID/SECRET` are set, `/signin` also exposes a "Continue with
X" button. Required for social tasks that reference a Twitter handle (admin
allow-list via `ADMIN_TWITTER_HANDLES` only works for Twitter sign-in).

---

## Mochimo wallet binding (Mesh-verified)

[MochimoAddress](src/domain/wallet/mochimo-address.ts) handles both address formats:

| Form | Example | Source |
| --- | --- | --- |
| Hex (canonical) | `0xd9c0c06c5383eb5cc0159f618101003d3b7abe84` | sent to Mesh API |
| Base58 tag | `226qEKxKSKCXMVtmBFVPKAz7H5aVjgH` | display on dashboard / leaderboard |

`base58TagToHex()` converts between them: the tag decodes to 22 bytes — the
20-byte account tag plus a 2-byte checksum. Verified against two known pairs
(`226qEK…` → `d9c0c0…30be`, `7JTCuV…` → `17371f…`). Mesh answers *"Invalid
account format"* for base58, so every on-chain call goes through the decoder.

The deposit wallet users pay to register comes from `MOCHIMO_DEPOSIT_TAG`
(see `.env.example`) via [app-config.ts](src/infrastructure/config/app-config.ts).

`MeshGateway.checkAddress()` POSTs the hex to
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

`POST /api/tasks/submit` → [SubmitTaskProof](src/application/tasks/submit-task-proof.ts):

1. Auth + ban check.
2. Wallet required for non-DAILY tasks.
3. **Tweet URL normalization**: any submission shaped like a tweet URL
   (x.com, twitter.com, mobile, with tracking params, `/photo/1` suffix,
   etc.) is run through `TweetId.fromUrl()` in
   [TweetId](src/domain/tasks/proof.ts) and stored in canonical form
   `https://x.com/{user}/status/{id}`.
4. **Tweet-ID dedup across the whole system**, including `FLAGGED` status —
   the same tweet can never be claimed twice, by anyone, in any format.
5. URL pattern validation (tweet / youtube / medium regexes).
6. `maxPerUser` and `cooldownHrs` enforcement (DAILY tasks → 20h cooldown).
7. AUTO/NONE tasks (daily check-in, referral credit) → instant
   `AUTO_APPROVED` + points awarded.
8. Otherwise: AI moderation → `auto-approve >= 0.85`, `flag <= 0.2`,
   otherwise PENDING for admin.
9. `RewardsRepository.award()` increments `points` *and* `lifetimePoints` and
   writes a `PointsLedger` row tagged with `YYYY-MM`, in one transaction.

### Admin moderation

`/admin/submissions` lists PENDING / FLAGGED. Each row
([src/components/review-row.tsx](src/components/review-row.tsx)) shows the
AI verdict + score and offers **Re-moderate**, **Approve**, **Reject**.

---

## Monthly leaderboard reset

[ResetLeaderboard](src/application/rewards/reset-leaderboard.ts):

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

## Architecture — domain-driven layering

The code is organised by **bounded context**, not by file type. A rule lives in
exactly one place, and the layers only ever point inward: `app/` depends on
`application/`, which depends on `domain/`. `domain/` depends on nothing —
no Prisma, no Next, no `process.env`, no `fetch`.

```
src/
├── domain/                        # the rules. Pure TypeScript, no I/O.
│   ├── shared/                    #   DomainError taxonomy, Period, Clock/RandomSource ports
│   ├── wallet/                    #   ┌ MochimoAddress (tag+hex are ONE identity)
│   │                              #   │ ChallengeAmount, WalletClaim (aggregate root)
│   │                              #   └ RegistrationPolicy, MeshGateway port
│   ├── identity/                  #   Username, PlainPassword/PasswordHash, UserAccount,
│   │                              #   Session, PasswordHasher port
│   ├── tasks/                     #   Task, Submission (aggregate root), Proof/TweetId,
│   │                              #   ModerationPolicy, ContentModerator port
│   └── rewards/                   #   Points, ReferralPolicy, leaderboard ports
│
├── application/                   # use cases — orchestration + transaction boundaries
│   ├── wallet/                    #   StartWalletClaim, PollWalletClaim
│   ├── identity/                  #   RegisterWithWallet, SignInWithCredentials,
│   │                              #   LinkWallet, LinkReferrer
│   ├── tasks/                     #   SubmitTaskProof, ReviewSubmission, ModerateProof
│   ├── rewards/                   #   AwardReferralBonus, ResetLeaderboard
│   └── shared/unit-of-work.ts     #   UnitOfWork + Repositories ports
│
├── infrastructure/                # the outside world. Implements the ports above.
│   ├── prisma/                    #   one repository per aggregate + PrismaUnitOfWork
│   ├── mesh/                      #   MochimoMeshGateway (Rosetta: mempool + block scan)
│   ├── ai/                        #   LlmContentModerator (Claude, Grok fallback)
│   ├── crypto/                    #   ScryptPasswordHasher, nodeRandom
│   ├── config/app-config.ts       #   THE only place that reads process.env
│   └── container.ts               #   composition root — wires ports to adapters
│
├── interface/http/                # error-mapper (DomainError → status), session cookie
│
├── app/                           # Next.js: pages + thin API controllers
│   └── api/…                      #   parse → call a use case → serialize. No rules here.
└── components/                    # UI
```

### What the layering buys

**One rule, one home.** The referral bonus used to be implemented twice — in
the wallet sign-up route and in the "save my wallet" route — and the copies had
already drifted. Now `ReferralPolicy` states the rule once ("earned when the
invitee first has a wallet"), and both paths call `AwardReferralBonus`.

**Illegal states stop being reachable.** `WalletClaim.consume()` is the only
way to spend a claim and it refuses when the claim is unverified, expired, or
already used — so no future route can forget one of those checks. Same for
`Submission.approve()`, which refuses a second approval, and `MochimoAddress`,
which cannot exist unless the tag decodes to the hex.

**Transports are replaceable.** Use cases throw `DomainError`; only
[error-mapper.ts](src/interface/http/error-mapper.ts) turns that into a status
code. The same use case runs from a script or a test with no HTTP in sight.

**Config can't leak into rules.** Policies take settings; they never read the
environment. `FREE_SIGNUP_MODE`, the deposit wallet, and the Mesh URL are read
in [app-config.ts](src/infrastructure/config/app-config.ts) alone.

### Reading the flow

Sign-up, end to end: [start-claim/route.ts](src/app/api/wallet/start-claim/route.ts)
→ [StartWalletClaim](src/application/wallet/start-wallet-claim.ts) →
[RegistrationPolicy](src/domain/wallet/registration-policy.ts) +
[WalletClaim](src/domain/wallet/wallet-claim.ts) →
[PrismaWalletClaimRepository](src/infrastructure/prisma/wallet-claim.repository.ts).
The route is 25 lines and contains no rules; every decision above is testable
without a database.

```
prisma/schema.prisma                      # persistence model (unchanged by the refactor)
prisma/seed.ts                            # 16 starter tasks
src/lib/                                  # framework glue: prisma client, Auth.js, cn()
src/middleware.ts.bak                     # disabled — Prisma adapter can't run on Edge
```

Note: `middleware.ts` is intentionally renamed to `.bak`. NextAuth middleware
with the Prisma adapter runs on Edge and can't query the DB; pages already
guard with their own `auth()` + `redirect()` so the middleware was redundant.

---

## Brand key visual (landing hero)

The landing page opens with the **Post-Quantum Armor** key visual, rendered by
[BrandHero](src/components/brand-hero.tsx).

**Drop the artwork here — the repo ships a placeholder:**

```bash
cp /path/to/post-quantum-armor.jpg public/brand/hero-armor.jpg
```

Requirements: 16:9, at least 1792×1008, dark left half (that's where the copy
sits). WebP is worth the conversion — it typically halves the bytes on a hero
this dark:

```bash
magick post-quantum-armor.jpg -quality 82 public/brand/hero-armor.webp
# then point BrandHero's <Image src> at the .webp
```

How the component handles the artwork:

- **Copy sits in the left negative space**, where the figure isn't — the two
  never compete for the same pixels.
- **The scrim is directional**: opaque→transparent left-to-right on desktop,
  bottom-up on mobile, so the text always lands on the darkest region. The
  desktop scrim is fully opaque through the first 26% of the frame, which
  covers the artwork's baked-in MOCHIMO lockup (the navbar already shows it).
- **Narrow screens re-frame rather than squash**: `object-position` pans to the
  shield so the subject survives the crop.
- `next/image` with `priority` + `sizes="100vw"` generates the responsive
  srcset; the hero is the LCP element, so don't lazy-load it.

## Brand teal theme



Always-dark HSL tokens in [src/app/globals.css](src/app/globals.css), Tailwind
extensions in [tailwind.config.ts](tailwind.config.ts). The accent is
`#16e299` — sampled from the official mark in `public/mcm-logo.jpg`, not
eyeballed, so the UI and the key visual agree:

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

- **Wallet ownership IS proven** — the user pays an exact random amount from
  the claimed wallet to the deposit address inside a 15-minute window, and we
  match both legs of that transaction. Remaining rough edges:
  - Sign-up **costs the user** the challenge amount (≤ 0.001 MCM) plus the
    500 nMCM fee. Cheap, but not free, and it can't be refunded automatically
    yet — set `FREE_SIGNUP_MODE=on` to waive it for a public test build (at
    the cost of proving nothing; see above).
  - Blocks are ~170s apart, so a payment that misses the mempool window is
    seen only when mined; the claim TTL is sized around that.
  - The block scan looks back `CONFIRMED_BLOCK_LOOKBACK` (8) blocks. Raise it
    if you also raise `CLAIM_TTL_SEC` in
    [RegistrationPolicy](src/domain/wallet/registration-policy.ts),
    or a claim can expire pointing at a block the scan no longer reaches.
- **Tweet freshness** isn't verified — daily tasks accept any tweet from
  @mochimo's history, not just today's. Needs X API integration to check
  `created_at`.
- **Username uniqueness** is case-folded server-side but the same person
  can sign up multiple times with different usernames + different wallets.
  Adequate for a faucet program; tighten if needed.
