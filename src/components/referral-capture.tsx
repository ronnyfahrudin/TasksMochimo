"use client";
import { useEffect } from "react";

/**
 * Drop on /dashboard. If the user just signed in via /signin?ref=CODE, the
 * code is forwarded as a query param to /dashboard. We POST it to the
 * referral-claim API once and then strip it from the URL.
 */
export function ReferralCapture({ code }: { code?: string }) {
  useEffect(() => {
    if (!code) return;
    fetch("/api/referral/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .catch(() => {})
      .finally(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("ref");
        window.history.replaceState({}, "", url.toString());
      });
  }, [code]);
  return null;
}
