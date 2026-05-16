import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const BodySchema = z.object({ code: z.string().min(1).max(64) });

/**
 * Called by the dashboard after a referred user signs up.
 * Links the new user to the referrer; the actual points award fires when
 * the new user saves their Mochimo address (see /api/user/mochimo-address).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { referredById: true, referralCode: true },
  });
  if (me?.referredById) {
    return NextResponse.json({ ok: true, alreadyLinked: true });
  }
  if (me?.referralCode === parsed.data.code) {
    return NextResponse.json({ error: "Cannot refer yourself" }, { status: 400 });
  }

  const referrer = await prisma.user.findUnique({
    where: { referralCode: parsed.data.code },
    select: { id: true },
  });
  if (!referrer) {
    return NextResponse.json({ error: "Invalid referral code" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { referredById: referrer.id },
  });

  return NextResponse.json({ ok: true, linked: true });
}
