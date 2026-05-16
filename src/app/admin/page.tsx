import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Users, FileCheck2, AlertTriangle, Trophy } from "lucide-react";
import { currentPeriod, formatPoints } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    redirect("/");
  }

  const [pending, flagged, totalUsers, totalApproved] = await Promise.all([
    prisma.submission.count({ where: { status: "PENDING" } }),
    prisma.submission.count({ where: { status: "FLAGGED" } }),
    prisma.user.count(),
    prisma.submission.count({ where: { status: { in: ["APPROVED", "AUTO_APPROVED"] } } }),
  ]);

  return (
    <div className="container py-10 space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Admin · Mochimo Tasks</h1>
        <p className="text-muted-foreground">
          Current period <code className="text-neon">{currentPeriod()}</code>
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={<FileCheck2 className="h-5 w-5" />} label="Pending review" value={pending} accent />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="AI-flagged" value={flagged} accent />
        <StatCard icon={<Users className="h-5 w-5" />} label="Users" value={formatPoints(totalUsers)} />
        <StatCard icon={<Trophy className="h-5 w-5" />} label="Approved subs" value={formatPoints(totalApproved)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Submission queue</CardTitle>
          <CardDescription>
            Review pending and AI-flagged task proofs.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link href="/admin/submissions">Open queue</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/submissions?status=FLAGGED">Flagged only</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          {icon}
          {label}
        </div>
        <div className={`mt-2 text-3xl font-bold ${accent ? "text-neon text-glow" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
