"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, ExternalLink } from "lucide-react";

type Field = "username" | "tag" | "hex" | "password" | "confirmPassword";

export function WalletSignupForm({ referralCode }: { referralCode?: string }) {
  const [values, setValues] = useState({
    username: "",
    tag: "",
    hex: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [meshNote, setMeshNote] = useState<string | null>(null);

  function set(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  function clientValidate(): boolean {
    const e: Partial<Record<Field, string>> = {};
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(values.username)) {
      e.username = "3–24 chars: letters, numbers, underscore only";
    }
    if (values.tag.length < 24 || values.tag.length > 64) {
      e.tag = "Mochimo tag looks invalid (24–64 chars)";
    }
    if (!/^(0x)?[0-9a-fA-F]{40}$/.test(values.hex)) {
      e.hex = "Hex must be 40 hex chars (with optional 0x prefix)";
    }
    if (values.password.length < 8) {
      e.password = "At least 8 characters";
    }
    if (values.password !== values.confirmPassword) {
      e.confirmPassword = "Passwords do not match";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setMeshNote(null);
    if (!clientValidate()) return;

    setBusy(true);
    try {
      const r = await fetch("/api/auth/wallet-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, referralCode: referralCode || undefined }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.field) {
          setErrors((prev) => ({ ...prev, [data.field as Field]: data.error }));
        }
        throw new Error(data.error ?? "Sign-up failed");
      }
      if (data.meshVerified) {
        toast.success(
          data.balanceMcm
            ? `Wallet verified · balance ${data.balanceMcm} nMCM`
            : "Wallet verified on-chain.",
        );
      } else {
        setMeshNote(data.meshNote ?? "On-chain check skipped");
        toast.warning("Account created. On-chain check skipped.");
      }
      window.location.href = "/dashboard";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-up failed";
      if (!Object.values(errors).some(Boolean)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* 1. Username */}
      <Row
        id="su-username"
        label="Username"
        hint="3–24 chars (letters, numbers, _)."
        value={values.username}
        error={errors.username}
        onChange={(v) => set("username", v)}
        placeholder="ronnyfahrudin"
      />

      {/* 2. Account tag */}
      <Row
        id="su-tag"
        label="Mochimo account tag"
        hint="Base58 tag shown on Mochiscan, e.g. 226qEKxKSK…"
        value={values.tag}
        error={errors.tag}
        onChange={(v) => set("tag", v)}
        placeholder="226qEKxKSKCXMVtmBFVPKAz7H5aVjgH"
        mono
      />

      {/* 3. Hex with mochiscan helper */}
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
          placeholder="0xd9c0c06c5383eb5cc0159f618101003d3b7abe84"
          value={values.hex}
          onChange={(e) => set("hex", e.target.value)}
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          40 hex chars (with optional <code className="text-neon">0x</code>). We verify this on-chain via the Mochimo Mesh API.
        </p>
        {errors.hex && <p className="text-xs text-red-400">{errors.hex}</p>}
      </div>

      {/* 4. Password */}
      <Row
        id="su-password"
        label="Password"
        hint="At least 8 characters."
        value={values.password}
        error={errors.password}
        onChange={(v) => set("password", v)}
        placeholder="••••••••"
        type="password"
      />

      {/* 5. Confirm password */}
      <Row
        id="su-confirm"
        label="Confirm password"
        value={values.confirmPassword}
        error={errors.confirmPassword}
        onChange={(v) => set("confirmPassword", v)}
        placeholder="••••••••"
        type="password"
      />

      {meshNote && <p className="text-xs text-yellow-400">{meshNote}</p>}

      <Button
        type="submit"
        disabled={busy || Object.values(values).some((v) => !v)}
        className="w-full"
        size="lg"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating account…
          </>
        ) : (
          <>
            <ShieldCheck className="h-4 w-4" />
            Create account
          </>
        )}
      </Button>
    </form>
  );
}

function Row({
  id,
  label,
  hint,
  value,
  error,
  onChange,
  placeholder,
  type,
  mono,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type ?? "text"}
        autoComplete={type === "password" ? "new-password" : "off"}
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={mono ? "font-mono text-xs" : ""}
      />
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
