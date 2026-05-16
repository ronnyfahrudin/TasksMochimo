import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { moderateContent } from "@/lib/ai-moderate";

const BodySchema = z.object({
  taskTitle: z.string().min(1).max(200),
  taskDescription: z.string().max(2000),
  proofUrl: z.string().url().max(2048).optional(),
  proofText: z.string().max(4000).optional(),
});

/** Manual AI re-moderation endpoint — admins only. */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN" && session.user.role !== "MODERATOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const verdict = await moderateContent(parsed.data);
  return NextResponse.json(verdict);
}
