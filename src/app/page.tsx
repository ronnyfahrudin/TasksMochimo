import { auth } from "@/lib/auth";
import { BrandHero } from "@/components/brand-hero";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";

export default async function HomePage() {
  const session = await auth();

  return (
    <>
      <BrandHero signedIn={Boolean(session?.user)} />

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
            ["1", "Prove your wallet", "Paste your tag + hex, then send the exact challenge amount from that wallet."],
            ["2", "Pick a username", "Set a username and password. Connect X later if you want social tasks."],
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
