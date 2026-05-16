import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskCard, type TaskCardData } from "@/components/task-card";
import { Card, CardContent } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { formatPoints } from "@/lib/utils";

const CATEGORIES = ["ALL", "SOCIAL", "CONTENT", "REFERRAL", "DAILY"] as const;

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const userId = session.user.id;

  const [tasks, submissions] = await Promise.all([
    prisma.task.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { points: "desc" }],
    }),
    prisma.submission.findMany({
      where: { userId },
      select: {
        taskId: true,
        status: true,
        createdAt: true,
        pointsAwarded: true,
      },
    }),
  ]);

  const submissionsByTask = new Map<string, typeof submissions>();
  for (const s of submissions) {
    const arr = submissionsByTask.get(s.taskId) ?? [];
    arr.push(s);
    submissionsByTask.set(s.taskId, arr);
  }

  const items: TaskCardData[] = tasks.map((t) => {
    const subs = submissionsByTask.get(t.id) ?? [];
    const completedCount = subs.filter(
      (s) => s.status === "APPROVED" || s.status === "AUTO_APPROVED",
    ).length;
    const pendingCount = subs.filter(
      (s) => s.status === "PENDING" || s.status === "FLAGGED",
    ).length;
    let cooldownUntil: string | null = null;
    if (t.cooldownHrs && subs.length > 0) {
      const last = subs
        .filter((s) => s.status === "APPROVED" || s.status === "AUTO_APPROVED")
        .sort((a, b) => +b.createdAt - +a.createdAt)[0];
      if (last) {
        cooldownUntil = new Date(+last.createdAt + t.cooldownHrs * 3600 * 1000).toISOString();
      }
    }
    return {
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
      category: t.category,
      points: t.points,
      proofType: t.proofType,
      proofUrlHint: t.proofUrlHint,
      cooldownHrs: t.cooldownHrs,
      completedCount,
      maxPerUser: t.maxPerUser,
      pendingCount,
      cooldownUntil,
    };
  });

  // Aggregate stats for the header banner
  const totalTasks = items.length;
  const doneTasks = items.filter(
    (i) => i.maxPerUser != null && i.completedCount >= i.maxPerUser,
  ).length;
  const completionCount = items.reduce((acc, i) => acc + i.completedCount, 0);
  const pendingTotal = items.reduce((acc, i) => acc + i.pendingCount, 0);
  const earnedThisPeriod = submissions.reduce((acc, s) => acc + s.pointsAwarded, 0);

  return (
    <div className="container py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Tasks</h1>
        <p className="text-muted-foreground mt-1">
          Pick a quest, submit proof, earn $MCM points.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="Available tasks" value={`${totalTasks - doneTasks}/${totalTasks}`} />
          <Stat label="Completions" value={formatPoints(completionCount)} />
          <Stat label="Pending review" value={formatPoints(pendingTotal)} accent={pendingTotal > 0} />
          <Stat label="Earned (lifetime sub.)" value={formatPoints(earnedThisPeriod)} accent />
        </CardContent>
      </Card>

      <Tabs defaultValue="ALL">
        <TabsList>
          {CATEGORIES.map((c) => (
            <TabsTrigger key={c} value={c}>
              {c.charAt(0) + c.slice(1).toLowerCase()}
            </TabsTrigger>
          ))}
        </TabsList>

        {CATEGORIES.map((c) => {
          const filtered = c === "ALL" ? items : items.filter((t) => t.category === c);
          return (
            <TabsContent key={c} value={c}>
              {filtered.length === 0 ? (
                <p className="text-muted-foreground text-sm">No tasks in this category yet.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((t) => (
                    <TaskCard key={t.id} task={t} />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${accent ? "text-neon text-glow" : ""}`}>
        {value}
      </div>
    </div>
  );
}
