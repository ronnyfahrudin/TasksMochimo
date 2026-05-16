import Image from "next/image";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, ShieldCheck, Sparkles, Trophy, Users, Wallet } from "lucide-react";

export default async function HomePage() {
  const session = await auth();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_70%)]" />
        <div className="container relative py-20 md:py-32 text-center">
          <div className="mx-auto mb-8 relative h-32 w-32 md:h-40 md:w-40 rounded-full ring-2 ring-neon/50 shadow-neon animate-pulse-neon overflow-hidden">
            <Image
              src="/mcm-logo.jpg"
              alt="Mochimo logo"
              fill
              sizes="160px"
              priority
              className="object-cover"
            />
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight">
            Earn{" "}
            <span className="gradient-text-neon text-glow">$MCM</span>{" "}
            for building Mochimo.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            The official quest board for the quantum-resistant blockchain. Complete
            social, content, referral, and daily tasks. Climb the monthly leaderboard.
            Get rewarded.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            {session?.user ? (
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Open dashboard <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button asChild size="lg">
                <Link href="/signup">
                  <Wallet className="h-4 w-4" />
                  Sign up with Mochimo wallet
                </Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link href="/tasks">Browse tasks</Link>
            </Button>
          </div>

          {!session?.user && (
            <p className="mt-4 text-xs text-muted-foreground">
              We verify your address on-chain via the Mochimo Mesh API before
              creating your account. X (Twitter) is optional.
            </p>
          )}
        </div>
      </section>

      {/* Feature cards */}
      <section className="container py-16">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={<Sparkles className="h-6 w-6" />}
            title="Social quests"
            text="Follow, retweet, quote-tweet. Quick wins for community boosters."
          />
          <Feature
            icon={<ShieldCheck className="h-6 w-6" />}
            title="Content rewards"
            text="Write Medium articles or shoot YouTube explainers — up to 800 points."
          />
          <Feature
            icon={<Users className="h-6 w-6" />}
            title="Referral system"
            text="Get 100 pts per referred user with a valid wallet + X connect."
          />
          <Feature
            icon={<Trophy className="h-6 w-6" />}
            title="Monthly leaderboard"
            text="Resets on the 1st. Historical ranks preserved. Top contributors get extra MCM."
          />
        </div>
      </section>

      {/* How it works */}
      <section className="container py-16 max-w-4xl text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-12">How it works</h2>
        <div className="grid md:grid-cols-3 gap-6 text-left">
          {[
            ["1", "Connect X", "Sign in with your X account in one click."],
            ["2", "Add Mochimo wallet", "Paste your $MCM base58 address — we verify the format."],
            ["3", "Complete tasks", "Earn points, climb the leaderboard, get paid in $MCM."],
          ].map(([n, title, text]) => (
            <Card key={n}>
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-full bg-neon/15 text-neon flex items-center justify-center font-bold mb-4 shadow-neon-sm">
                  {n}
                </div>
                <h3 className="font-semibold text-lg mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-muted-foreground">
        Mochimo Tasks · Quantum-resistant rewards · Not financial advice
      </footer>
    </>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="h-10 w-10 rounded-md bg-neon/15 text-neon flex items-center justify-center mb-4 shadow-neon-sm">
          {icon}
        </div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
