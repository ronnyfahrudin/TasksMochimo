import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthenticatedError, ValidationError } from "@/domain/shared/errors";
import { auth } from "@/lib/auth";
import { useCases } from "@/infrastructure/container";
import { toErrorResponse } from "@/interface/http/error-mapper";

const BodySchema = z.object({
  taskTitle: z.string().min(1).max(200),
  taskDescription: z.string().max(2000),
  proofUrl: z.string().url().max(2048).optional(),
  proofText: z.string().max(4000).optional(),
});

/** Manual AI re-moderation from the review queue — moderators only. */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthenticatedError();

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new ValidationError("body.invalid", "Invalid body");

    const verdict = await useCases
      .moderateProof()
      .execute({ requestedById: session.user.id, ...parsed.data });

    return NextResponse.json({
      verdict: verdict.verdict,
      score: verdict.score,
      reason: verdict.reason,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
