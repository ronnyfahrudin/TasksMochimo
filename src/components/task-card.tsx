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
import { Check, Clock, Loader2 } from "lucide-react";

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
  cooldownUntil?: string | null;
};

const CATEGORY_STYLE: Record<TaskCardData["category"], string> = {
  SOCIAL: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  CONTENT: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  REFERRAL: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  DAILY: "bg-neon/15 text-neon border-neon/30",
};

function formatRemaining(target: Date): string {
  const ms = +target - Date.now();
  if (ms <= 0) return "available now";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m`;
  return `${Math.floor(ms / 1000)}s`;
}

export function TaskCard({ task }: { task: TaskCardData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const [proofText, setProofText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const cooldownActive =
    task.cooldownUntil && new Date(task.cooldownUntil).getTime() > Date.now();
  const maxedOut =
    task.maxPerUser != null && task.completedCount >= task.maxPerUser;
  const done = maxedOut; // fully completed and won't ever be available again
  const locked = maxedOut || cooldownActive;

  // For "NONE" proof (daily check-in) and "AUTO" tasks, skip the dialog and
  // submit directly — there's nothing for the user to fill in.
  const needsForm = !(task.proofType === "NONE" || task.proofType === "AUTO");

  async function submit(payload?: { proofUrl?: string; proofText?: string }) {
    setSubmitting(true);
    try {
      const r = await fetch("/api/tasks/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          proofUrl: payload?.proofUrl ?? proofUrl,
          proofText: payload?.proofText ?? proofText,
        }),
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

  const buttonLabel = done
    ? "Done"
    : cooldownActive
      ? "Cooldown"
      : task.proofType === "NONE"
        ? "Check in"
        : task.proofType === "AUTO"
          ? "Claim"
          : "Submit proof";

  return (
    <Card className={done ? "opacity-70 ring-1 ring-neon/20" : undefined}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <Badge className={CATEGORY_STYLE[task.category]} variant="outline">
            {task.category}
          </Badge>
          <div className="flex items-center gap-1.5">
            {done && (
              <Badge variant="success" className="gap-1">
                <Check className="h-3 w-3" />
                Done
              </Badge>
            )}
            <span className="font-bold text-neon text-glow whitespace-nowrap">
              +{task.points} pts
            </span>
          </div>
        </div>
        <CardTitle className="mt-2 text-base">{task.title}</CardTitle>
        <CardDescription>{task.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 text-xs text-muted-foreground space-y-1">
        {task.maxPerUser ? (
          <div className="flex items-center gap-1.5">
            <span>Completed:</span>
            <span className="font-mono text-foreground">
              {task.completedCount}/{task.maxPerUser}
            </span>
            {done && <Check className="h-3 w-3 text-neon" />}
          </div>
        ) : task.completedCount > 0 ? (
          <div>
            Completed: <span className="font-mono text-foreground">{task.completedCount}×</span>
          </div>
        ) : null}
        {task.pendingCount > 0 ? (
          <div className="text-yellow-400">Pending review: {task.pendingCount}</div>
        ) : null}
        {cooldownActive && (
          <div className="inline-flex items-center gap-1 text-neon">
            <Clock className="h-3 w-3" />
            Available in {formatRemaining(new Date(task.cooldownUntil!))}
          </div>
        )}
      </CardContent>
      <CardFooter>
        {needsForm ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="w-full" disabled={locked}>
                {locked && done && <Check className="h-4 w-4" />}
                {buttonLabel}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{task.title}</DialogTitle>
                <DialogDescription>{task.description}</DialogDescription>
              </DialogHeader>
              {(task.proofType === "TWEET_URL" ||
                task.proofType === "YOUTUBE_URL" ||
                task.proofType === "MEDIUM_URL") && (
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
                  onClick={() => submit()}
                  disabled={
                    submitting ||
                    ((task.proofType === "TWEET_URL" ||
                      task.proofType === "YOUTUBE_URL" ||
                      task.proofType === "MEDIUM_URL") &&
                      !proofUrl) ||
                    (task.proofType === "TEXT" && !proofText)
                  }
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    "Submit"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <Button
            className="w-full"
            disabled={locked || submitting}
            onClick={() => submit({})}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                {done && <Check className="h-4 w-4" />}
                {buttonLabel}
              </>
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
