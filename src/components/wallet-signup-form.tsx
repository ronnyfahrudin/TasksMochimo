"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, ExternalLink, Check, Copy } from "lucide-react";
import { mochimoHexSchema, mochimoTagSchema } from "@/lib/mochimo";

type Step = "wallet" | "verifying" | "credentials";

type WalletErrors = { tag?: string; hex?: string };
type CredErrors = { username?: string; password?: string; confirmPassword?: string };

const POLL_INTERVAL_MS = 5000;

/** Copy to clipboard, tolerating browsers that block it outside a gesture. */
async function copy(value: string, message: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(message);
  } catch {
    toast.info("Copy blocked by the browser — select the value and copy manually.");
  }
}

export function WalletSignupForm({ referralCode }: { referralCode?: string }) {
  const [step, setStep] = useState<Step>("wallet");

  // Step 1: wallet inputs
  const [tag, setTag] = useState("");
  const [hex, setHex] = useState("");
  const [walletErr, setWalletErr] = useState<WalletErrors>({});
  const [walletBusy, setWalletBusy] = useState(false);

  // Verification state
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [challengeNanoMcm, setChallengeNanoMcm] = useState<number | null>(null);
  const [challengeMcm, setChallengeMcm] = useState<string | null>(null);
  const [depositTag, setDepositTag] = useState<string | null>(null);
  const [depositHex, setDepositHex] = useState<string | null>(null);
  const [verifiedTxHash, setVerifiedTxHash] = useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 3: credentials
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [credErr, setCredErr] = useState<CredErrors>({});
  const [credBusy, setCredBusy] = useState(false);

  // ─── Step 1: open claim ─────────────────────────────────────────────
  async function startClaim(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs: WalletErrors = {};
    const tagParsed = mochimoTagSchema.safeParse(tag);
    const hexParsed = mochimoHexSchema.safeParse(hex);
    if (!tagParsed.success) errs.tag = tagParsed.error.issues[0]?.message;
    if (!hexParsed.success) errs.hex = hexParsed.error.issues[0]?.message;
    setWalletErr(errs);
    if (Object.keys(errs).length) return;

    setWalletBusy(true);
    try {
      const r = await fetch("/api/wallet/start-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: tagParsed.data, hex: hexParsed.data }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to start claim");
      setClaimToken(data.claimToken);
      setExpiresAt(new Date(data.expiresAt));
      setChallengeNanoMcm(data.challengeNanoMcm);
      setChallengeMcm(data.challengeMcm);
      setDepositTag(data.depositTag);
      setDepositHex(data.depositHex);
      setStep("verifying");
      // Auto-copy the amount — it has to be exact, and this click is still
      // inside the user gesture that submitted the form, so the browser
      // allows it. Manual copy buttons remain for everything else.
      copy(data.challengeMcm, "Amount copied — paste it as the MCM amount");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start claim";
      toast.error(msg);
    } finally {
      setWalletBusy(false);
    }
  }

  // ─── Step 2: poll until verified ────────────────────────────────────
  useEffect(() => {
    if (step !== "verifying" || !claimToken) return;

    let cancelled = false;
    async function pollOnce() {
      try {
        const r = await fetch("/api/wallet/poll-claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimToken }),
        });
        const data = await r.json();
        if (cancelled) return;
        if (data.status === "verified") {
          setVerifiedTxHash(data.verifiedTxHash);
          setStep("credentials");
          toast.success("Wallet ownership verified.");
          return;
        }
        if (data.status === "expired") {
          setVerifyMsg("Claim window expired. Start over.");
          if (pollTimer.current) clearInterval(pollTimer.current);
          return;
        }
        if (data.status === "not_found") {
          setVerifyMsg("Claim missing. Start over.");
          if (pollTimer.current) clearInterval(pollTimer.current);
          return;
        }
        setVerifyMsg(null);
      } catch {
        // network blip, keep polling
      }
    }

    pollOnce();
    pollTimer.current = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [step, claimToken]);

  // Countdown ticker
  useEffect(() => {
    if (step !== "verifying" || !expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step, expiresAt]);

  function abortAndRestart() {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setStep("wallet");
    setClaimToken(null);
    setExpiresAt(null);
    setChallengeNanoMcm(null);
    setChallengeMcm(null);
    setDepositTag(null);
    setDepositHex(null);
    setVerifyMsg(null);
  }

  // ─── Step 3: submit credentials + claim ────────────────────────────
  async function submitCredentials(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs: CredErrors = {};
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username))
      errs.username = "3–24 chars: letters, numbers, underscore only";
    if (password.length < 8) errs.password = "At least 8 characters";
    if (password !== confirm) errs.confirmPassword = "Passwords do not match";
    setCredErr(errs);
    if (Object.keys(errs).length) return;

    setCredBusy(true);
    try {
      const r = await fetch("/api/auth/wallet-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimToken,
          username,
          password,
          confirmPassword: confirm,
          referralCode: referralCode || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.field) setCredErr((p) => ({ ...p, [data.field]: data.error }));
        throw new Error(data.error ?? "Sign-up failed");
      }
      toast.success("Account created. Welcome!");
      window.location.href = "/dashboard";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-up failed";
      if (!Object.values(errs).some(Boolean)) toast.error(msg);
    } finally {
      setCredBusy(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  if (step === "wallet") {
    return (
      <form onSubmit={startClaim} className="space-y-4">
        <FieldRow id="su-tag" label="Mochimo account tag" hint="Base58 tag shown on Mochiscan."
          value={tag} error={walletErr.tag} onChange={setTag} mono />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="su-hex">Hex address</Label>
            <a
              href="https://mochiscan.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-[11px] text-neon hover:underline inline-flex items-center gap-0.5"
            >
              See the hex on Mochiscan
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Input
            id="su-hex"
            autoComplete="off"
            spellCheck={false}
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            40 hex chars (with optional <code className="text-neon">0x</code>).
          </p>
          {walletErr.hex && <p className="text-xs text-red-400">{walletErr.hex}</p>}
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={walletBusy || !tag || !hex}>
          {walletBusy ? (<><Loader2 className="h-4 w-4 animate-spin" />Starting…</>) : "Start wallet verification"}
        </Button>
      </form>
    );
  }

  if (step === "verifying") {
    const remainingMs = expiresAt ? Math.max(0, +expiresAt - now) : 0;
    const totalSec = Math.floor(remainingMs / 1000);
    const ss = (totalSec % 60).toString().padStart(2, "0");
    const mm = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const expired = remainingMs <= 0;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-neon/30 bg-neon/5 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-neon">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-semibold">Waiting for transaction…</span>
            </div>
            <span className={`font-mono text-lg ${expired ? "text-red-400" : "text-neon"}`}>
              {mm}:{ss}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              1 · Send EXACTLY this amount
            </div>
            <div className="flex items-center gap-2 rounded-md border border-neon/40 bg-background/60 px-3 py-2">
              <code className="flex-1 text-neon text-glow text-xl font-mono break-all">
                {challengeMcm} MCM
              </code>
              <button
                type="button"
                onClick={() => challengeMcm && copy(challengeMcm, "Amount copied")}
                className="text-neon hover:text-neon-glow"
                aria-label="Copy amount"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              = <code className="text-neon">{challengeNanoMcm} nMCM</code> · the amount must
              match to the last digit — that is what identifies you
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">
              2 · To this address
            </div>
            <div className="flex items-center gap-2 rounded-md border border-neon/40 bg-background/60 px-3 py-2">
              <code className="flex-1 text-neon font-mono text-sm break-all">
                {depositTag ?? "…"}
              </code>
              <button
                type="button"
                onClick={() => depositTag && copy(depositTag, "Address copied")}
                className="text-neon hover:text-neon-glow"
                aria-label="Copy address"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {depositHex && (
              <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                <span>hex:</span>
                <code className="text-neon truncate">0x{depositHex}</code>
                <button
                  type="button"
                  onClick={() => copy(`0x${depositHex}`, "Hex copied")}
                  className="hover:text-neon shrink-0"
                  aria-label="Copy deposit hex"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-2 pt-1 border-t border-white/5">
            <span>From your wallet:</span>
            <code className="text-neon truncate flex-1">0x{hex.replace(/^0x/i, "").toLowerCase()}</code>
            <button
              type="button"
              onClick={() => copy(`0x${hex.replace(/^0x/i, "").toLowerCase()}`, "Hex copied")}
              className="hover:text-neon"
              aria-label="Copy hex"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>

          {verifyMsg && <p className="text-xs text-yellow-400">{verifyMsg}</p>}
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={abortAndRestart}>
          {expired ? "Generate new code" : "Cancel & start over"}
        </Button>
      </div>
    );
  }

  // step === "credentials"
  return (
    <form onSubmit={submitCredentials} className="space-y-4">
      <div className="rounded-lg border border-neon/40 bg-neon/10 p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-neon font-semibold text-sm">
          <Check className="h-4 w-4" />
          Wallet verified
        </div>
        <div className="text-[11px] text-muted-foreground">
          Tx: <code className="text-neon">{verifiedTxHash?.slice(0, 24)}…</code>
        </div>
      </div>

      <FieldRow id="su-username" label="Username" hint="3–24 chars (letters, numbers, _)."
        value={username} error={credErr.username} onChange={setUsername} />
      <FieldRow id="su-password" label="Password" hint="At least 8 characters."
        value={password} error={credErr.password} onChange={setPassword} type="password" />
      <FieldRow id="su-confirm" label="Confirm password"
        value={confirm} error={credErr.confirmPassword} onChange={setConfirm} type="password" />

      <Button type="submit" disabled={credBusy} className="w-full" size="lg">
        {credBusy ? (<><Loader2 className="h-4 w-4 animate-spin" />Creating account…</>) : (<><ShieldCheck className="h-4 w-4" />Create account</>)}
      </Button>
    </form>
  );
}

function FieldRow({
  id, label, hint, value, error, onChange, type, mono,
}: {
  id: string; label: string; hint?: string; value: string; error?: string;
  onChange: (v: string) => void; type?: string; mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type ?? "text"}
        autoComplete={type === "password" ? "new-password" : "off"}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? "font-mono text-xs" : ""}
      />
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
