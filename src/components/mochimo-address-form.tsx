"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mochimoAddressSchema } from "@/lib/mochimo";

export function MochimoAddressForm({ initial }: { initial?: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const parsed = mochimoAddressSchema.safeParse(value);
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? "Invalid address");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/user/mochimo-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: parsed.data }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      toast.success("Mochimo address saved");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="mcm-addr">Mochimo wallet address (base58)</Label>
        <Input
          id="mcm-addr"
          spellCheck={false}
          autoComplete="off"
          placeholder="3aXyZ…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : initial ? "Update address" : "Save address"}
      </Button>
    </form>
  );
}
