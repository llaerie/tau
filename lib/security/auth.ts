/**
 * Session authentication on top of the signed cookie.
 *
 * Lab mode: a missing or invalid token resolves to the default OWNER actor.
 * Full mode: the token must verify AND belong to a user that still exists in the user
 * directory; the role and display name are refreshed from the directory so a role change
 * or removal takes effect without waiting for the cookie to expire.
 */
import type { Actor } from "@/lib/core/types";
import { ControlViolationError } from "@/lib/core/errors";
import { resolveAuthMode } from "./auth-mode";
import { LAB_DEFAULT_ACTOR, resolveActor, SESSION_COOKIE_NAME, createSessionToken, serializeSessionCookie } from "./session";
import { findUserById, type PublicUser } from "./users";

export function actorForUser(user: PublicUser): Actor {
  return { type: "USER", id: user.id, role: user.role, displayName: user.displayName };
}

/** Full-mode check: throws unless the token is valid and maps to a current user. */
export function authenticateFullModeToken(token: string | undefined | null, opts: { now?: () => number } = {}): Actor {
  const actor = resolveActor(token, opts); // throws in full mode when missing/invalid
  if (actor.type !== "USER") throw new ControlViolationError("Session actor is not a user", { reason: "INVALID_ACTOR" });
  const user = findUserById(actor.id);
  if (!user) throw new ControlViolationError("Session does not belong to a known user", { reason: "UNKNOWN_USER" });
  return actorForUser(user);
}

/**
 * Resolve the acting user for a request. Never falls back to the lab actor in full mode:
 * a forged, expired or absent cookie throws `ControlViolationError`.
 */
export function authenticateSessionToken(token: string | undefined | null, opts: { now?: () => number } = {}): Actor {
  if (resolveAuthMode() === "lab") {
    try {
      return resolveActor(token, opts);
    } catch {
      return { ...LAB_DEFAULT_ACTOR };
    }
  }
  return authenticateFullModeToken(token, opts);
}

export function loginCookieFor(user: PublicUser): string {
  return serializeSessionCookie(createSessionToken(actorForUser(user)));
}

export function logoutCookie(): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
