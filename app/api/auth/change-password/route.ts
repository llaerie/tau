import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { resolveAuthMode } from "@/lib/security/auth-mode";
import { findUserById, setPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/security/users";
import { clearLoginFailures, loginRateLimitStatus, recordLoginFailure } from "@/lib/security/login-rate-limit";

/** Change the signed-in user's password. Requires the current password; shares the login throttle. */
export const POST = withApi(async (req, _ctx, actor) => {
  if (resolveAuthMode() !== "full") return apiError("Password changes are only available in full auth mode", 403, "NOT_FULL_MODE");
  const user = findUserById(actor.id);
  if (!user) return apiError("Session does not belong to a known user", 401, "UNAUTHENTICATED");
  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(req);
  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!current || !next) return apiError("currentPassword and newPassword are required");
  if (next.length < MIN_PASSWORD_LENGTH) return apiError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (next === current) return apiError("New password must differ from the current password");
  if (loginRateLimitStatus(user.email).blocked) return apiError("Too many failed attempts. Try again later.", 429, "RATE_LIMITED");
  if (!verifyPassword(user.email, current)) {
    recordLoginFailure(user.email);
    return apiError("Current password is incorrect", 403, "PERMISSION_DENIED");
  }
  setPassword(user.email, next);
  clearLoginFailures(user.email);
  return json({ ok: true, message: "Password updated" });
});
