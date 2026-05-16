import Image from "next/image";
import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  const { ref } = await searchParams;

  return (
    <div className="container max-w-md py-20">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto h-16 w-16 relative rounded-full overflow-hidden ring-1 ring-neon/40 shadow-neon-sm mb-4">
            <Image src="/mcm-logo.jpg" alt="Mochimo" fill sizes="64px" />
          </div>
          <CardTitle className="text-2xl">Sign in to Mochimo Tasks</CardTitle>
          <CardDescription>
            Connect your X account. You can add your Mochimo wallet address after signing in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server";
              const dest = ref ? `/dashboard?ref=${encodeURIComponent(ref)}` : "/dashboard";
              await signIn("twitter", { redirectTo: dest });
            }}
          >
            <Button type="submit" className="w-full" size="lg">
              Continue with X (Twitter)
            </Button>
          </form>
          <p className="text-xs text-muted-foreground text-center mt-6">
            By signing in you agree not to use bots, multi-accounts, or spam content.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
