import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { WalletSignupForm } from "@/components/wallet-signup-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { ref } = await searchParams;

  return (
    <div className="container max-w-md py-16">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto h-16 w-16 relative rounded-full overflow-hidden ring-2 ring-neon/50 shadow-neon-sm mb-3">
            <Image src="/mcm-logo.jpg" alt="Mochimo" fill sizes="64px" priority />
          </div>
          <CardTitle className="text-2xl">Get started</CardTitle>
          <CardDescription>
            Start with your Mochimo wallet — we&apos;ll verify it on-chain before
            you earn any points.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <WalletSignupForm referralCode={ref} />

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            or
            <Separator className="flex-1" />
          </div>

          <form
            action={async () => {
              "use server";
              const dest = ref
                ? `/dashboard?ref=${encodeURIComponent(ref)}`
                : "/dashboard";
              await signIn("twitter", { redirectTo: dest });
            }}
          >
            <Button type="submit" variant="outline" className="w-full" size="lg">
              Continue with X (Twitter)
            </Button>
          </form>

          <p className="text-xs text-muted-foreground text-center">
            Already have an account?{" "}
            <Link href="/signin" className="text-neon hover:underline">
              Sign in
            </Link>
          </p>

          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            By signing up you agree not to use bots or multi-accounts. Wallet-only
            accounts can&apos;t complete social tasks until they connect X.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
