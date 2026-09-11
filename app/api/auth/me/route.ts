import { withApi, json } from "@/lib/ui/api";
import { resolveAuthMode } from "@/lib/security/auth-mode";
import { permissionsFor } from "@/lib/security/rbac";

/** Current actor, auth mode and permissions. 401 in full mode without a valid session. */
export const GET = withApi(async (_req, _ctx, actor) => {
  return json({ mode: resolveAuthMode(), actor, permissions: permissionsFor(actor.role) });
});
