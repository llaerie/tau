import { NextResponse } from "next/server";
import { withApi, apiError, readJson } from "@/lib/ui/api";
import { LAB_ROLES, labActorForRole, sessionCookieFor } from "@/lib/ui/session";
import { isLabMode } from "@/lib/security/session";
import type { Role } from "@/lib/core/types";

/** Lab-only role switcher: sets the signed session cookie for one of the lab roles. Disabled in full auth mode. */
export const POST = withApi(async (req) => {
  if (!isLabMode()) return apiError("Role switching is only available in lab mode (TAU_AUTH_MODE=lab)", 403, "NOT_LAB_MODE");
  const body = await readJson<{ role?: string }>(req);
  const role = body.role as Role;
  if (!LAB_ROLES.includes(role)) return apiError(`role must be one of ${LAB_ROLES.join(", ")}`);
  const actor = labActorForRole(role);
  const res = NextResponse.json({ actor, message: `Session switched to ${role}` });
  res.headers.set("set-cookie", sessionCookieFor(actor));
  return res;
});
