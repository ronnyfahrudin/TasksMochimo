"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mochimoHexSchema, mochimoTagSchema } from "@/lib/mochimo";

export function MochimoAddressForm({
  initialHex,
  initialTag,
}: {
  initialHex?: string | null;
  initialTag?: string | null;
}) {
  const router = useRouter();
  const [hex, setHex] = useState(initialHex ?? "");
  const [tag, setTag] = useState(initialTag ?? "");
  const [hexErr, setHexErr] = useState<string | null>(null);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setHexErr(null);
    setTagErr(null);

    const hexParsed = mochimoHexSchema.safeParse(hex);
    const tagParsed = mochimoTagSchema.safeParse(tag);
    if (!hexParsed.success) setHexErr(hexParsed.error.issues[0]?.message ?? "Invalid hex");
    if (!tagParsed.success) setTagErr(tagParsed.error.issues[0]?.message ?? "Invalid tag");
    if (!hexParsed.success || !tagParsed.success) return;

    setSaving(true);
    try {
      const r = await fetch("/api/user/mochimo-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hex: hexParsed.data, tag: tagParsed.data }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      if (data.meshVerified) {
        toast.success(
          data.balanceMcm
            ? `Wallet verified · balance ${data.balanceMcm} nMCM`
            : "Wallet verified on-chain",
        );
      } else {
        toast.warning("Saved. On-chain check skipped.");
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      if (/hex/i.test(msg)) setHexErr(msg);
      else if (/tag/i.test(msg)) setTagErr(msg);
      else toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="mcm-hex-d">Hex address</Label>
        <Input
          id="mcm-hex-d"
          spellCheck={false}
          autoComplete="off"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="font-mono text-xs"
        />
        {hexErr && <p className="text-xs text-red-400">{hexErr}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mcm-tag-d">Display tag (base58)</Label>
        <Input
          id="mcm-tag-d"
          spellCheck={false}
          autoComplete="off"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="font-mono text-xs"
        />
        {tagErr && <p className="text-xs text-red-400">{tagErr}</p>}
      </div>

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : initialHex ? "Update wallet" : "Save wallet"}
      </Button>
    </form>
  );
}
