import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth?.user;
  const role = req.auth?.user?.role;

  if (pathname.startsWith("/admin")) {
    if (!isAuthed) return NextResponse.redirect(new URL("/signin", req.url));
    if (role !== "ADMIN" && role !== "MODERATOR")
      return NextResponse.redirect(new URL("/", req.url));
  }

  if ((pathname.startsWith("/dashboard") || pathname.startsWith("/tasks")) && !isAuthed) {
    return NextResponse.redirect(new URL("/signin", req.url));
  }
});

export const config = {
  matcher: ["/dashboard/:path*", "/tasks/:path*", "/admin/:path*"],
};
