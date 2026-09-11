/**
 * Auth gate (Node.js runtime so it can read the user directory and verify HMAC cookies).
 *
 * Lab mode: pass-through — nothing changes for the single-owner training lab.
 * Full mode: every dashboard page needs a valid signed session that maps to a current
 * user; otherwise the browser is redirected to /login (the bad cookie is cleared) and
 * API routes get a 401 JSON error. /login, /api/auth/* and static assets are always open.
 */
import { NextResponse, type NextRequest } from "next/server";
import { resolveAuthMode } from "@/lib/security/auth-mode";
import { authenticateFullModeToken, logoutCookie } from "@/lib/security/auth";
import { SESSION_COOKIE_NAME } from "@/lib/security/session";

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|txt|xml|woff2?)$).*)"],
};

function isOpenPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/api/auth/");
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();
  if (resolveAuthMode() !== "full") return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  try {
    authenticateFullModeToken(token);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      const res = NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Invalid or missing session" } }, { status: 401 });
      if (token) res.headers.set("set-cookie", logoutCookie());
      return res;
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const next = `${pathname}${search}`;
    if (next !== "/" && next !== "/overview") url.searchParams.set("next", next);
    const res = NextResponse.redirect(url);
    if (token) res.headers.set("set-cookie", logoutCookie());
    return res;
  }
}
