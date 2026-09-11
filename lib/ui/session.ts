/**
 * Server-side actor resolution from the signed session cookie.
 * Lab mode falls back to the default OWNER actor when no cookie is present.
 */
import { cookies } from "next/headers";
import type { Actor, Role } from "@/lib/core/types";
import { LAB_DEFAULT_ACTOR, SESSION_COOKIE_NAME, resolveActor, sessionCookieValue, createSessionToken, serializeSessionCookie, isLabMode } from "@/lib/security/session";
import { can, type Permission } from "@/lib/security/rbac";

/** Actor for the current server component / server action request. */
export async function getActor(): Promise<Actor> {
  try {
    const jar = await cookies();
    const token = jar.get(SESSION_COOKIE_NAME)?.value;
    return resolveActor(token);
  } catch {
    return { ...LAB_DEFAULT_ACTOR };
  }
}

/** Actor from a route-handler Request (cookie header). Throws in full auth mode when invalid. */
export function actorFromRequest(req: Request): Actor {
  const token = sessionCookieValue(req.headers.get("cookie"));
  try {
    return resolveActor(token);
  } catch (err) {
    if (isLabMode()) return { ...LAB_DEFAULT_ACTOR };
    throw err;
  }
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
