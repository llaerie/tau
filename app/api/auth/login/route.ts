import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/ui/api";
import { hasUsers, verifyPassword, normalizeEmail, MAX_PASSWORD_LENGTH } from "@/lib/security/users";
import { loginCookieFor, actorForUser } from "@/lib/security/auth";
import { clearLoginFailures, loginRateLimitStatus, recordLoginFailure } from "@/lib/security/login-rate-limit";

const GENERIC = "Invalid email or password";

/**
 * Password login. Issues the signed session cookie for the user's actor.
 * Failures are generic (no account enumeration) and throttled per email:
 * 5 failed attempts per 15 minutes. Nothing about the password is logged.
 */
export async function POST(req: Request): Promise<Response> {
  if (!hasUsers()) return apiError("No users are configured; run `npm run users:add` first", 409, "NO_USERS");
  const body = await readJson<{ email?: unknown; password?: unknown }>(req).catch(() => null);
  if (!body) return apiError("Body must be valid JSON");
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 254 || password.length > MAX_PASSWORD_LENGTH) return apiError(GENERIC, 401, "UNAUTHENTICATED");

  const status = loginRateLimitStatus(email);
  if (status.blocked) {
    return apiError("Too many failed attempts. Try again later.", 429, "RATE_LIMITED", { retryAfterSeconds: Math.ceil(status.retryAfterMs / 1000) });
  }
  const user = verifyPassword(email, password);
  if (!user) {
    recordLoginFailure(email);
    return apiError(GENERIC, 401, "UNAUTHENTICATED");
  }
  clearLoginFailures(email);
  const res = NextResponse.json({ actor: actorForUser(user), message: `Signed in as ${user.displayName}` });
  res.headers.set("set-cookie", loginCookieFor(user));
  return res;
}
