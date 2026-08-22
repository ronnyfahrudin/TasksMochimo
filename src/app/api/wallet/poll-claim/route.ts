import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/domain/shared/errors";
import { useCases } from "@/infrastructure/container";
import { toErrorResponse } from "@/interface/http/error-mapper";

const BodySchema = z.object({ claimToken: z.string().min(32).max(128) });

/** Status of a claim: has the challenge payment landed yet? */
export async function POST(req: Request) {
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw new ValidationError("body.invalid", "Invalid body");

    return NextResponse.json(await useCases.pollWalletClaim().execute(parsed.data));
  } catch (error) {
    // The client polls this every 5s and treats a 404 as "start over", so a
    // missing claim must stay a body it can read rather than a thrown 500.
    const res = toErrorResponse(error);
    if (res.status === 404) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return res;
  }
}
