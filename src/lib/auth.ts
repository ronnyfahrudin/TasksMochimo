import NextAuth, { type DefaultSession } from "next-auth";
import Twitter from "next-auth/providers/twitter";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "USER" | "MODERATOR" | "ADMIN";
      twitterHandle?: string | null;
      mochimoAddress?: string | null;
      points: number;
      referralCode: string;
    } & DefaultSession["user"];
  }
}

/**
 * Admin membership.
 *
 * ADMIN_TWITTER_IDS is the real control: an X numeric id is immutable, while a
 * @handle can be renamed and then registered by someone else — whoever picks
 * up an abandoned admin handle would otherwise inherit admin rights.
 *
 * ADMIN_TWITTER_HANDLES still works so existing deployments keep functioning,
 * but it is a migration path, not a destination.
 */
const adminIds = (process.env.ADMIN_TWITTER_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const adminHandles = (process.env.ADMIN_TWITTER_HANDLES ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  pages: {
    signIn: "/signin",
  },
  providers: [
    Twitter({
      clientId: process.env.AUTH_TWITTER_ID!,
      clientSecret: process.env.AUTH_TWITTER_SECRET!,
    }),
  ],
  events: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "twitter" || !user?.id) return;
      // Capture twitter handle + id on first login (and refresh on subsequent).
      const p = profile as
        | { data?: { id?: string; username?: string }; id_str?: string; screen_name?: string }
        | undefined;
      const twitterId = p?.data?.id ?? p?.id_str ?? account.providerAccountId;
      const handle = (p?.data?.username ?? p?.screen_name ?? "").toLowerCase();
      const byId = twitterId ? adminIds.includes(String(twitterId)) : false;
      const byHandle = adminHandles.includes(handle);
      if (byHandle && !byId) {
        console.warn(
          `[auth] granting ADMIN to @${handle} by handle — set ADMIN_TWITTER_IDS=${twitterId} instead; handles can change hands`,
        );
      }
      const isAdmin = byId || byHandle;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twitterId: twitterId ?? undefined,
          twitterHandle: handle || undefined,
          role: isAdmin ? "ADMIN" : undefined,
        },
      });
    },
  },
  callbacks: {
    async session({ session, user }) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          role: true,
          twitterHandle: true,
          mochimoAddress: true,
          points: true,
          referralCode: true,
        },
      });
      if (dbUser) {
        session.user.id = dbUser.id;
        session.user.role = dbUser.role;
        session.user.twitterHandle = dbUser.twitterHandle;
        session.user.mochimoAddress = dbUser.mochimoAddress;
        session.user.points = dbUser.points;
        session.user.referralCode = dbUser.referralCode;
      }
      return session;
    },
  },
});

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Response("Unauthorized", { status: 401 });
  return session.user;
}

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) throw new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    throw new Response("Forbidden", { status: 403 });
  }
  return session.user;
}
