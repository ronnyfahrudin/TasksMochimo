import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { currentPeriod, formatPoints, previousPeriod } from "@/lib/utils";
import { Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const session = await auth();
  const me = session?.user?.id;

  const [monthly, allTime, lastMonth] = await Promise.all([
    prisma.user.findMany({
      where: { points: { gt: 0 } },
      orderBy: { points: "desc" },
      take: 50,
      select: {
        id: true,
        twitterHandle: true,
        image: true,
        name: true,
        points: true,
      },
    }),
    prisma.user.findMany({
      where: { lifetimePoints: { gt: 0 } },
      orderBy: { lifetimePoints: "desc" },
      take: 50,
      select: {
        id: true,
        twitterHandle: true,
        image: true,
        name: true,
        lifetimePoints: true,
      },
    }),
    prisma.leaderboardSnapshot.findMany({
      where: { period: previousPeriod() },
      orderBy: { rank: "asc" },
      take: 25,
      include: { user: { select: { twitterHandle: true, image: true, name: true } } },
    }),
  ]);

  return (
    <div className="container py-10 space-y-8">
      <div className="flex items-center gap-3">
        <Trophy className="h-8 w-8 text-neon text-glow" />
        <div>
          <h1 className="text-3xl font-bold">Leaderboard</h1>
          <p className="text-muted-foreground text-sm">
            Resets on the 1st of each month. Historical ranks preserved.
          </p>
        </div>
      </div>

      <Tabs defaultValue="monthly">
        <TabsList>
          <TabsTrigger value="monthly">This month ({currentPeriod()})</TabsTrigger>
          <TabsTrigger value="alltime">All-time</TabsTrigger>
          <TabsTrigger value="history">Last month</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly">
          <LeaderboardTable
            rows={monthly.map((u, i) => ({
              rank: i + 1,
              userId: u.id,
              twitterHandle: u.twitterHandle,
              image: u.image,
              name: u.name,
              points: u.points,
            }))}
            highlight={me}
          />
        </TabsContent>

        <TabsContent value="alltime">
          <LeaderboardTable
            rows={allTime.map((u, i) => ({
              rank: i + 1,
              userId: u.id,
              twitterHandle: u.twitterHandle,
              image: u.image,
              name: u.name,
              points: u.lifetimePoints,
            }))}
            highlight={me}
          />
        </TabsContent>

        <TabsContent value="history">
          {lastMonth.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No history yet</CardTitle>
                <CardDescription>
                  A snapshot of {previousPeriod()} will appear here after the next reset.
                </CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ) : (
            <LeaderboardTable
              rows={lastMonth.map((s) => ({
                rank: s.rank,
                userId: s.userId,
                twitterHandle: s.user.twitterHandle ?? s.twitterHandle,
                image: s.user.image,
                name: s.user.name,
                points: s.points,
              }))}
              highlight={me}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Row = {
  rank: number;
  userId: string;
  twitterHandle: string | null;
  image: string | null;
  name: string | null;
  points: number;
};

function LeaderboardTable({ rows, highlight }: { rows: Row[]; highlight?: string }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No data yet — be the first!
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="pt-6 px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Rank</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Points</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const isMe = r.userId === highlight;
              const medal = r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : null;
              return (
                <TableRow
                  key={r.userId}
                  className={isMe ? "bg-neon/5 ring-1 ring-inset ring-neon/30" : undefined}
                >
                  <TableCell className="font-mono">
                    {medal ? <span className="text-xl">{medal}</span> : `#${r.rank}`}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        {r.image ? <AvatarImage src={r.image} alt="" /> : null}
                        <AvatarFallback>
                          {(r.twitterHandle ?? r.name ?? "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="leading-tight">
                        <div className="text-sm font-medium">
                          {r.name ?? r.twitterHandle ?? "anon"}
                          {isMe && <span className="text-neon ml-2 text-xs">(you)</span>}
                        </div>
                        {r.twitterHandle && (
                          <div className="text-xs text-muted-foreground">
                            @{r.twitterHandle}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-bold text-neon">
                    {formatPoints(r.points)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
