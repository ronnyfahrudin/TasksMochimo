import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthenticatedError, ValidationError } from "@/domain/shared/errors";
import { auth } from "@/lib/auth";
import { useCases } from "@/infrastructure/container";
import { enforceRateLimit, RULES } from "@/infrastructure/security/rate-limit";
import { toErrorResponse } from "@/interface/http/error-mapper";

const BodySchema = z.object({
  taskId: z.string().min(1),
  proofUrl: z.string().url().max(2048).optional().or(z.literal("")),
  proofText: z.string().max(4000).optional().or(z.literal("")),
});

/** Submit proof for a task. */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthenticatedError();

    enforceRateLimit(RULES.submitPerUser, session.user.id);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ValidationError("body.invalid", parsed.error.issues[0]?.message ?? "Invalid body");
    }

    const result = await useCases.submitTaskProof().execute({
      userId: session.user.id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
