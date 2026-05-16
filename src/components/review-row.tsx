"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, X, RefreshCw, ExternalLink } from "lucide-react";
import { shortAddress } from "@/lib/utils";

export type ReviewSubmission = {
  id: string;
  createdAt: string;
  status: string;
  proofUrl: string | null;
  proofText: string | null;
  aiScore: number | null;
  aiVerdict: string | null;
  aiReason: string | null;
  task: { title: string; points: number; proofType: string; category: string };
  user: {
    twitterHandle: string | null;
    mochimoAddress: string | null;
    name: string | null;
    image: string | null;
  };
};

export function ReviewRow({ submission }: { submission: ReviewSubmission }) {
  const router = useRouter();
  const [working, setWorking] = useState<"approve" | "reject" | "remod" | null>(null);
  const [reason, setReason] = useState("");
  const [ai, setAi] = useState<{
    score: number;
    verdict: string;
    reason: string;
  } | null>(
    submission.aiScore != null
      ? {
          score: submission.aiScore,
          verdict: submission.aiVerdict ?? "review",
          reason: submission.aiReason ?? "",
        }
      : null,
  );

  async function decide(action: "approve" | "reject") {
    setWorking(action);
    try {
      const r = await fetch(`/api/admin/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: action === "reject" ? reason : undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      toast.success(`Submission ${data.status.toLowerCase()}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setWorking(null);
    }
  }

  async function remoderate() {
    setWorking("remod");
    try {
      const r = await fetch("/api/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskTitle: submission.task.title,
          taskDescription: "",
          proofUrl: submission.proofUrl ?? undefined,
          proofText: submission.proofText ?? undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      setAi({ score: data.score, verdict: data.verdict, reason: data.reason });
      toast.success(`AI: ${data.verdict} (${(data.score * 100).toFixed(0)}%)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setWorking(null);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-9 w-9">
            {submission.user.image ? <AvatarImage src={submission.user.image} alt="" /> : null}
            <AvatarFallback>
              {(submission.user.twitterHandle ?? "?").slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">@{submission.user.twitterHandle ?? "anon"}</span>
              <Badge variant="outline">{submission.task.category}</Badge>
              <Badge variant="default">+{submission.task.points} pts</Badge>
              <Badge variant={submission.status === "FLAGGED" ? "warning" : "secondary"}>
                {submission.status}
              </Badge>
            </div>
            <div className="text-sm mt-1">{submission.task.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Wallet: {shortAddress(submission.user.mochimoAddress) || "(none)"} ·{" "}
              {new Date(submission.createdAt).toLocaleString()}
            </div>
          </div>
        </div>

        {submission.proofUrl && (
          <a
            href={submission.proofUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-neon hover:underline inline-flex items-center gap-1 break-all"
          >
            {submission.proofUrl} <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {submission.proofText && (
          <pre className="text-xs whitespace-pre-wrap bg-white/5 border border-white/10 rounded p-3">
            {submission.proofText}
          </pre>
        )}

        {ai && (
          <div className="rounded-md border border-neon/20 bg-neon/5 p-3 text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">AI verdict:</span>{" "}
              <span className="text-neon font-semibold">{ai.verdict}</span> ·{" "}
              <span className="text-muted-foreground">score</span>{" "}
              {(ai.score * 100).toFixed(0)}%
            </div>
            <div className="text-muted-foreground">{ai.reason}</div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => decide("approve")}
            disabled={working !== null}
          >
            <Check className="h-4 w-4" />
            {working === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={remoderate}
            disabled={working !== null}
          >
            <RefreshCw className="h-4 w-4" />
            {working === "remod" ? "Asking AI…" : "Re-moderate"}
          </Button>
          <div className="flex-1 min-w-[200px]" />
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reject reason (shown to user)"
            className="max-w-sm min-h-[40px]"
          />
          <Button
            size="sm"
            variant="destructive"
            onClick={() => decide("reject")}
            disabled={working !== null}
          >
            <X className="h-4 w-4" />
            {working === "reject" ? "Rejecting…" : "Reject"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
