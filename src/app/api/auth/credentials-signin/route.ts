import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthenticatedError } from "@/domain/shared/errors";
import { useCases } from "@/infrastructure/container";
import { clientIp, enforceRateLimit, RULES } from "@/infrastructure/security/rate-limit";
import { toErrorResponse } from "@/interface/http/error-mapper";
import { setSessionCookie } from "@/interface/http/session-cookie";

const BodySchema = z.object({
  username: z.string().min(1).max(40),
  password: z.string().min(1).max(128),
});

/** Username + password sign-in. */
export async function POST(req: Request) {
  try {
    // Throttle before touching scrypt: verifying a password costs ~50ms of
    // CPU by design, which is exactly what makes an unthrottled login endpoint
    // a cheap denial-of-service as well as a guessing oracle.
    enforceRateLimit(RULES.signInPerIp, clientIp(req));

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      // Same message as a wrong password: a malformed body must not confirm
      // anything about which usernames exist.
      throw new UnauthenticatedError("Invalid username or password");
    }

    enforceRateLimit(RULES.signInPerUser, parsed.data.username.trim().toLowerCase());

    const { session } = await useCases.signInWithCredentials().execute(parsed.data);
    return setSessionCookie(NextResponse.json({ ok: true }), session);
  } catch (error) {
    return toErrorResponse(error);
  }
}
