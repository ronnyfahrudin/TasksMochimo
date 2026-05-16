"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

export function ReferralCard({
  referralCode,
  appUrl,
  referrals,
}: {
  referralCode: string;
  appUrl: string;
  referrals: number;
}) {
  const [copied, setCopied] = useState(false);
  const link = `${appUrl}/signin?ref=${referralCode}`;

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Referral link copied");
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your referral link</CardTitle>
        <CardDescription>
          Earn 100 points per referred user who connects X + a valid Mochimo wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-white/5 border border-white/10 px-3 py-2 text-xs font-mono">
            {link}
          </code>
          <Button size="icon" variant="outline" onClick={copy} aria-label="Copy">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          Referrals so far: <span className="text-neon font-semibold">{referrals}</span>
        </div>
      </CardContent>
    </Card>
  );
}
