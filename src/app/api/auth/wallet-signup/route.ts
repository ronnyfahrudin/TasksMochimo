import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/domain/shared/errors";
import { useCases } from "@/infrastructure/container";
import { hashSignupIp } from "@/infrastructure/security/ip-hash";
import { clientIp, enforceRateLimit, RULES } from "@/infrastructure/security/rate-limit";
import { toErrorResponse } from "@/interface/http/error-mapper";
import { setSessionCookie } from "@/interface/http/session-cookie";

const BodySchema = z.object({
  claimToken: z.string().min(32).max(128),
  username: z.string(),
  password: z.string(),
  confirmPassword: z.string(),
  referralCode: z.string().min(1).max(64).optional(),
});

/** Finalize sign-up: turn a verified wallet claim into an account + session. */
export async function POST(req: Request) {
  try {
    enforceRateLimit(RULES.signupPerIp, clientIp(req));

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ValidationError(
        "body.invalid",
        parsed.error.issues[0]?.message ?? "Invalid body",
        parsed.error.issues[0]?.path?.[0]?.toString(),
      );
    }

    const result = await useCases.registerWithWallet().execute({
      ...parsed.data,
      signupIpHash: hashSignupIp(clientIp(req)),
    });

    return setSessionCookie(
      NextResponse.json({
        ok: true,
        userId: result.userId,
        referralCode: result.referralCode,
        verifiedTxHash: result.verifiedTxHash,
        provenByPayment: result.provenByPayment,
      }),
      result.session,
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
