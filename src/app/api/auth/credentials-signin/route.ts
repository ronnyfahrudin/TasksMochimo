import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const BodySchema = z.object({
  username: z.string().min(1).max(40),
  password: z.string().min(1).max(128),
});

const SESSION_COOKIE = process.env.AUTH_URL?.startsWith("https://")
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

const SESSION_TTL_DAYS = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const username = parsed.data.username.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, passwordHash: true, bannedAt: true },
  });

  // Always run a verify on a placeholder hash if user not found, so the
  // timing tells the attacker nothing about whether the username exists.
  const PLACEHOLDER_HASH =
    "scrypt$32768$8$1$0000000000000000000000000000000000$0000000000000000";
  const ok = verifyPassword(parsed.data.password, user?.passwordHash ?? PLACEHOLDER_HASH);

  if (!user || !ok) {
    return NextResponse.json(
      { error: "Invalid username or password" },
      { status: 401 },
    );
  }
  if (user.bannedAt) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: SESSION_COOKIE.startsWith("__Secure-"),
    path: "/",
    expires,
  });
  return res;
}
