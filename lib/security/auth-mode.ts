/**
 * Auth mode resolution.
 *
 *  - `TAU_AUTH_MODE=full` / `TAU_AUTH_MODE=lab` win when set.
 *  - Otherwise: `full` as soon as the users file holds at least one user, `lab` before that.
 *
 * Lab mode keeps the single-owner training lab usable without a login; full mode requires
 * a signed session issued by `/api/auth/login` for every dashboard page and API route.
 */
import { hasUsers } from "./users";

export type AuthMode = "lab" | "full";

export function resolveAuthMode(): AuthMode {
  const raw = (process.env.TAU_AUTH_MODE ?? "").trim().toLowerCase();
  if (raw === "full") return "full";
  if (raw === "lab") return "lab";
  return hasUsers() ? "full" : "lab";
}

export function isFullAuthMode(): boolean {
  return resolveAuthMode() === "full";
}
