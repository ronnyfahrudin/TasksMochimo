import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthenticatedError, ValidationError } from "@/domain/shared/errors";
import { auth } from "@/lib/auth";
import { useCases } from "@/infrastructure/container";
import { toErrorResponse } from "@/interface/http/error-mapper";

const BodySchema = z.object({ hex: z.string(), tag: z.string() });

/** Bind a Mochimo wallet to an account that signed up through X. */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new UnauthenticatedError();

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new ValidationError("body.invalid", "Wallet tag and hex are required");

    const result = await useCases
      .linkWallet()
      .execute({ userId: session.user.id, ...parsed.data });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toErrorResponse(error);
  }
}
