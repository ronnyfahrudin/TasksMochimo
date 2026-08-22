import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthenticatedError, ValidationError } from "@/domain/shared/errors";
import { auth } from "@/lib/auth";
import { useCases } from "@/infrastructure/container";
import { toErrorResponse } from "@/interface/http/error-mapper";

const BodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional(),
});

/** Moderator settles one queued submission. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthenticatedError();

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new ValidationError("body.invalid", "Invalid body");

    const { id } = await ctx.params;
    const result = await useCases.reviewSubmission().execute({
      reviewerId: session.user.id,
      submissionId: id,
      ...parsed.data,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
