import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { MochimoAddressForm } from "@/components/mochimo-address-form";
import { ReferralCard } from "@/components/referral-card";
import { ReferralCapture } from "@/components/referral-capture";
import { Badge } from "@/components/ui/badge";
import { currentPeriod, formatPoints, shortAddress } from "@/lib/utils";

const PERIOD_GOAL = 1000;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const { ref } = await searchParams;

  const userId = session.user.id;

  const [user, submissions, totalTasks, rank, referralCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        twitterHandle: true,
        mochimoAddress: true,
        mochimoTag: true,
        points: true,
        lifetimePoints: true,
        referralCode: true,
      },
    }),
    prisma.submission.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { task: { select: { title: true, points: true, category: true } } },
    }),
    prisma.task.count({ where: { active: true } }),
    prisma.user.count({
      where: { points: { gt: 0 } /* tied rank: count users with strictly more pts */ },
    }),
    prisma.user.count({ where: { referredById: userId } }),
  ]);

  const aboveCount = await prisma.user.count({
    where: { points: { gt: user.points } },
  });
  const userRank = aboveCount + 1;

  const goalPct = Math.min(100, Math.round((user.points / PERIOD_GOAL) * 100));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="container py-10 space-y-8">
      <ReferralCapture code={ref} />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">
            Welcome back, <span className="text-neon">@{user.twitterHandle ?? "anon"}</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Period <code className="text-neon">{currentPeriod()}</code> · Rank #
            {userRank} of {rank || "—"}
          </p>
        </div>
        <div className="flex gap-6">
          <Stat label="This month" value={formatPoints(user.points)} accent />
          <Stat label="Lifetime" value={formatPoints(user.lifetimePoints)} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Monthly goal</span>
            <span className="text-sm text-muted-foreground font-normal">
              {formatPoints(user.points)} / {formatPoints(PERIOD_GOAL)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={goalPct} />
          <p className="text-xs text-muted-foreground mt-2">
            Reach {formatPoints(PERIOD_GOAL)} points to unlock the top-tier MCM payout.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mochimo wallet</CardTitle>
            <CardDescription>
              {user.mochimoAddress ? (
                <span className="block space-y-0.5">
                  <span className="block">
                    Hex:{" "}
                    <code className="text-neon">0x{shortAddress(user.mochimoAddress)}</code>
                  </span>
                  {user.mochimoTag && (
                    <span className="block">
                      Tag: <code className="text-neon">{user.mochimoTag}</code>
                    </span>
                  )}
                </span>
              ) : (
                "Required to receive payouts. Paste both hex (verified on-chain) and base58 tag."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MochimoAddressForm
              initialHex={user.mochimoAddress}
              initialTag={user.mochimoTag}
            />
          </CardContent>
        </Card>

        <ReferralCard
          referralCode={user.referralCode}
          appUrl={appUrl}
          referrals={referralCount}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent submissions</CardTitle>
          <CardDescription>
            {totalTasks} tasks available. Check the{" "}
            <a href="/tasks" className="text-neon hover:underline">tasks page</a> for more.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            submissions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.task.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
                <StatusBadge status={s.status} />
                <span className="text-neon font-semibold w-16 text-right">
                  {s.pointsAwarded > 0 ? `+${s.pointsAwarded}` : "—"}
                </span>
              </div>
            ))
          )}
          <Separator />
          <a className="text-sm text-neon hover:underline" href="/tasks">
            Browse all tasks →
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div
        className={`text-2xl font-bold ${accent ? "text-neon text-glow" : "text-foreground"}`}
      >
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "APPROVED" || status === "AUTO_APPROVED"
      ? "success"
      : status === "REJECTED"
        ? "destructive"
        : status === "FLAGGED"
          ? "warning"
          : "outline";
  return (
    <Badge variant={variant as never}>{status.toLowerCase().replace("_", " ")}</Badge>
  );
}
