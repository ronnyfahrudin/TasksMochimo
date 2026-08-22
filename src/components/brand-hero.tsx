import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Landing hero built around the "Post-Quantum Armor" key visual.
 *
 * Art direction notes — the artwork is composed, not just placed:
 *
 * - The figure and shield sit in the RIGHT half of the frame; the left is
 *   near-black negative space. That's where the copy goes, so the two never
 *   fight for the same pixels.
 * - The source file carries a baked-in MOCHIMO lockup (top left) and the
 *   "QUANTUM THREATS EVOLVE / MOCHIMO PROTECTS" tagline (right). The navbar
 *   already shows the logo, so the left scrim is opaque through that region to
 *   cover the duplicate lockup, and the copy column stops short of the tagline.
 * - On narrow screens the composition is re-framed rather than squashed:
 *   object-position pans to the shield, and the scrim flips to bottom-up so
 *   the text sits over the darkest part of the image.
 */
export function BrandHero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-white/5">
      {/* Key visual.

          Below 1024px the art is a BAND above the copy, not behind it. A 16:9
          frame simply has no room for a text column beside the figure at those
          widths: the shield ends up behind the body copy and buttons, and a
          portrait crop on phones loses the shield altogether. From lg up the
          frame is wide enough for both, so it becomes the full-bleed backdrop
          it was composed to be. */}
      <div className="relative h-64 w-full sm:h-80 md:h-[26rem] lg:absolute lg:inset-0 lg:-z-20 lg:h-auto">
        <Image
          src="/brand/hero-armor.webp"
          alt="Armored figure holding a shield marked Post-Quantum Armor"
          fill
          priority
          sizes="100vw"
          quality={90}
          className="object-cover object-[72%_center] md:object-center lg:object-[right_38%]"
        />
        {/* Soften the band into the page rather than cutting it with a hard edge. */}
        <div
          className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent lg:hidden"
          aria-hidden="true"
        />
      </div>

      {/* Desktop scrim: opaque through the copy column, clear over the shield.
          Fully opaque for the first 26% so the artwork's own lockup — which the
          navbar already shows — doesn't ghost through behind the headline. */}
      <div
        className="absolute inset-0 -z-10 hidden lg:block bg-[linear-gradient(90deg,hsl(var(--background))_0%,hsl(var(--background))_26%,hsl(var(--background)/0.72)_44%,transparent_66%)]"
        aria-hidden="true"
      />

      <div className="container relative">
        <div className="flex max-w-xl flex-col justify-center gap-6 pb-20 pt-8 md:pt-10 lg:max-w-md lg:min-h-[min(56vw,54rem)] lg:py-16 xl:max-w-xl">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-neon">
            Post-Quantum Currency
          </p>

          <h1 className="text-4xl font-extrabold tracking-tight text-balance md:text-6xl">
            Earn <span className="gradient-text-neon text-glow">$MCM</span> for
            building Mochimo.
          </h1>

          <p className="max-w-md text-lg text-muted-foreground">
            The official quest board for the quantum-resistant blockchain.
            Complete social, content, referral, and daily tasks. Climb the
            monthly leaderboard. Get rewarded.
          </p>

          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            {signedIn ? (
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

          {!signedIn && (
            <p className="max-w-sm text-xs text-muted-foreground">
              Your wallet is verified on-chain through the Mochimo Mesh API
              before the account is created. X (Twitter) is optional.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
