import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthenticatedError, ValidationError } from "@/domain/shared/errors";
import { auth } from "@/lib/auth";
import { useCases } from "@/infrastructure/container";
import { toErrorResponse } from "@/interface/http/error-mapper";

const BodySchema = z.object({ code: z.string().min(1).max(64) });

/** Record who referred the signed-in account. Attribution only, no payout. */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthenticatedError();

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new ValidationError("code.invalid", "Invalid code");

    const result = await useCases
      .linkReferrer()
      .execute({ userId: session.user.id, code: parsed.data.code });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
