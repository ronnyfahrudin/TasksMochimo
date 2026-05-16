"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type TaskCardData = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: "SOCIAL" | "CONTENT" | "REFERRAL" | "DAILY";
  points: number;
  proofType: "TWEET_URL" | "YOUTUBE_URL" | "MEDIUM_URL" | "TEXT" | "AUTO" | "NONE";
  proofUrlHint?: string | null;
  cooldownHrs?: number | null;
  completedCount: number;
  maxPerUser?: number | null;
  pendingCount: number;
  cooldownUntil?: string | null; // ISO date
};

const CATEGORY_STYLE: Record<TaskCardData["category"], string> = {
  SOCIAL: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  CONTENT: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  REFERRAL: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  DAILY: "bg-neon/15 text-neon border-neon/30",
};

export function TaskCard({ task }: { task: TaskCardData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const [proofText, setProofText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const locked =
    (task.maxPerUser != null && task.completedCount >= task.maxPerUser) ||
    (task.cooldownUntil && new Date(task.cooldownUntil).getTime() > Date.now());

  async function submit() {
    setSubmitting(true);
    try {
      const r = await fetch("/api/tasks/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, proofUrl, proofText }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Submission failed");
      if (data.status === "AUTO_APPROVED" || data.status === "APPROVED") {
        toast.success(`+${data.pointsAwarded} pts awarded!`);
      } else if (data.status === "FLAGGED") {
        toast.warning("AI flagged — pending manual review.");
      } else {
        toast.success("Submission received. Pending review.");
      }
      setOpen(false);
      setProofUrl("");
      setProofText("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  const needsUrl =
    task.proofType === "TWEET_URL" ||
    task.proofType === "YOUTUBE_URL" ||
    task.proofType === "MEDIUM_URL";

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <Badge className={CATEGORY_STYLE[task.category]} variant="outline">
            {task.category}
          </Badge>
          <span className="font-bold text-neon text-glow whitespace-nowrap">
            +{task.points} pts
          </span>
        </div>
        <CardTitle className="mt-2 text-base">{task.title}</CardTitle>
        <CardDescription>{task.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 text-xs text-muted-foreground space-y-1">
        {task.maxPerUser ? (
          <div>
            Completed: {task.completedCount}/{task.maxPerUser}
          </div>
        ) : task.completedCount > 0 ? (
          <div>Completed: {task.completedCount}×</div>
        ) : null}
        {task.pendingCount > 0 ? (
          <div>Pending review: {task.pendingCount}</div>
        ) : null}
        {task.cooldownUntil && new Date(task.cooldownUntil) > new Date() ? (
          <div>
            Available again: {new Date(task.cooldownUntil).toLocaleString()}
          </div>
        ) : null}
      </CardContent>
      <CardFooter>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="w-full" disabled={!!locked}>
              {locked ? "Locked" : task.proofType === "NONE" ? "Check in" : "Submit proof"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{task.title}</DialogTitle>
              <DialogDescription>{task.description}</DialogDescription>
            </DialogHeader>
            {needsUrl && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Proof URL</label>
                <Input
                  placeholder={task.proofUrlHint ?? "https://…"}
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                />
              </div>
            )}
            {task.proofType === "TEXT" && (
              <Textarea
                placeholder="Describe your proof…"
                value={proofText}
                onChange={(e) => setProofText(e.target.value)}
              />
            )}
            <DialogFooter>
              <Button
                onClick={submit}
                disabled={submitting || (needsUrl && !proofUrl) || (task.proofType === "TEXT" && !proofText)}
              >
                {submitting ? "Submitting…" : "Submit"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardFooter>
    </Card>
  );
}
