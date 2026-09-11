/**
 * Server-side actor resolution from the signed session cookie.
 *
 * Lab mode falls back to the default OWNER actor when no (valid) cookie is present.
 * Full mode never falls back: route handlers get a thrown error (mapped to 401 by
 * `withApi`) and server components are redirected to /login.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor, Role } from "@/lib/core/types";
import { LAB_DEFAULT_ACTOR, SESSION_COOKIE_NAME, sessionCookieValue, createSessionToken, serializeSessionCookie } from "@/lib/security/session";
import { authenticateSessionToken } from "@/lib/security/auth";
import { can, type Permission } from "@/lib/security/rbac";

/** Actor for the current server component / server action request. Redirects to /login in full mode when unauthenticated. */
export async function getActor(): Promise<Actor> {
  let token: string | undefined;
  try {
    const jar = await cookies();
    token = jar.get(SESSION_COOKIE_NAME)?.value;
  } catch {
    token = undefined;
  }
  let actor: Actor | null = null;
  try {
    actor = authenticateSessionToken(token);
  } catch {
    actor = null;
  }
  if (!actor) redirect("/login");
  return actor;
}

/** Actor from a route-handler Request (cookie header). Throws in full auth mode when missing or invalid. */
export function actorFromRequest(req: Request): Actor {
  return authenticateSessionToken(sessionCookieValue(req.headers.get("cookie")));
}

export const LAB_ROLES: readonly Role[] = ["OWNER", "FINANCE_OPERATOR", "CPA", "VIEWER"];

export function labActorForRole(role: Role): Actor {
  if (role === "OWNER") return { ...LAB_DEFAULT_ACTOR };
  const names: Partial<Record<Role, string>> = { FINANCE_OPERATOR: "Lab Finance Operator", CPA: "Lab CPA", VIEWER: "Lab Viewer" };
  return { type: "USER", id: `lab_${role.toLowerCase()}`, role, displayName: names[role] ?? `Lab ${role}` };
}

export function sessionCookieFor(actor: Actor): string {
  return serializeSessionCookie(createSessionToken(actor));
}

export function actorCan(actor: Actor, permission: Permission): boolean {
  return can(actor.role, permission);
}
