import Link from "next/link";
import Image from "next/image";
import { auth, signIn, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogIn, LogOut } from "lucide-react";
import { formatPoints } from "@/lib/utils";

export async function Navbar() {
  const session = await auth();
  const user = session?.user;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-background/70 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="relative h-9 w-9 overflow-hidden rounded-full ring-1 ring-neon/40 shadow-neon-sm group-hover:shadow-neon transition-shadow">
            <Image src="/mcm-logo.jpg" alt="Mochimo" fill sizes="36px" priority />
          </div>
          <span className="font-bold tracking-tight text-foreground">
            Mochimo<span className="text-neon text-glow">Tasks</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          <NavLink href="/tasks">Tasks</NavLink>
          <NavLink href="/leaderboard">Leaderboard</NavLink>
          {user && <NavLink href="/dashboard">Dashboard</NavLink>}
          {user?.role === "ADMIN" || user?.role === "MODERATOR" ? (
            <NavLink href="/admin">Admin</NavLink>
          ) : null}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="hidden sm:flex flex-col items-end leading-tight">
                <span className="text-xs text-muted-foreground">Points</span>
                <span className="font-bold text-neon text-glow">
                  {formatPoints(user.points ?? 0)}
                </span>
              </div>
              <Avatar className="h-9 w-9">
                {user.image ? (
                  <AvatarImage src={user.image} alt={user.name ?? ""} />
                ) : null}
                <AvatarFallback>
                  {(user.name ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <Button variant="ghost" size="icon" type="submit" aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </Button>
              </form>
            </>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("twitter", { redirectTo: "/dashboard" });
              }}
            >
              <Button type="submit" size="sm">
                <LogIn className="h-4 w-4" />
                Connect X
              </Button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-neon hover:bg-neon/5 transition-colors"
    >
      {children}
    </Link>
  );
}
