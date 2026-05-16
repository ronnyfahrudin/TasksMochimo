import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { ReviewRow } from "@/components/review-row";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "PENDING", label: "Pending" },
  { key: "FLAGGED", label: "Flagged" },
  { key: "ALL", label: "All" },
];

export default async function AdminQueue({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    redirect("/");
  }

  const { status } = await searchParams;
  const filter = (status ?? "PENDING").toUpperCase();
  const where =
    filter === "ALL"
      ? {}
      : { status: filter as "PENDING" | "FLAGGED" };

  const submissions = await prisma.submission.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      task: { select: { title: true, points: true, proofType: true, category: true } },
      user: { select: { twitterHandle: true, mochimoAddress: true, name: true, image: true } },
    },
  });

  return (
    <div className="container py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Submission queue</h1>
        <Tabs value={filter}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.key} value={f.key} asChild>
                <Link href={`/admin/submissions?status=${f.key}`}>{f.label}</Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {submissions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Inbox zero ✨</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            Nothing in this queue. Take a break.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {submissions.map((s) => (
            <ReviewRow
              key={s.id}
              submission={{
                id: s.id,
                createdAt: s.createdAt.toISOString(),
                status: s.status,
                proofUrl: s.proofUrl,
                proofText: s.proofText,
                aiScore: s.aiScore,
                aiVerdict: s.aiVerdict,
                aiReason: s.aiReason,
                task: s.task,
                user: s.user,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
