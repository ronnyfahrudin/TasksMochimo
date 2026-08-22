import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/domain/shared/errors";
import { useCases } from "@/infrastructure/container";
import { clientIp, enforceRateLimit, RULES } from "@/infrastructure/security/rate-limit";
import { toErrorResponse } from "@/interface/http/error-mapper";

const BodySchema = z.object({ hex: z.string(), tag: z.string() });

/**
 * Open a wallet-ownership claim. Controller only: parse, delegate, serialize.
 * Every rule about who may claim what lives in the wallet domain.
 */
export async function POST(req: Request) {
  try {
    // Each claim reserves a challenge amount and writes a row; flooding this
    // is both a cheap way to fill the table and the way an attacker searches
    // the challenge space.
    enforceRateLimit(RULES.startClaimPerIp, clientIp(req));

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ValidationError("body.invalid", "Wallet tag and hex are required");
    }

    const result = await useCases.startWalletClaim().execute(parsed.data);

    return NextResponse.json({
      claimToken: result.claimToken,
      claimId: result.claimId,
      expiresAt: result.expiresAt.toISOString(),
      ttlSeconds: result.ttlSeconds,
      instructions: result.instructions,
      ...(result.payment
        ? result.payment
        : { freeSignup: true }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
