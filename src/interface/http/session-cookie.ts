import type { NextResponse } from "next/server";
import type { Session } from "@/domain/identity/session";
import { sessionCookieName } from "@/infrastructure/config/app-config";

/**
 * Attach an Auth.js-compatible session cookie.
 *
 * HttpOnly keeps it away from scripts; SameSite=Lax blocks cross-site POSTs
 * from carrying it. The "__Secure-" prefix and the `secure` flag travel
 * together — browsers reject that prefix on a plain-HTTP response.
 */
export function setSessionCookie(res: NextResponse, session: Session): NextResponse {
  const name = sessionCookieName();
  res.cookies.set(name, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: name.startsWith("__Secure-"),
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
