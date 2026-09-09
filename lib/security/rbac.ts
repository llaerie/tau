/**
 * Role-based access control.
 *
 * The matrix is deliberately explicit: a permission a role does not list is denied.
 * VIEW_HOUSEHOLD exists so callers can ask for it, but it is never granted to any
 * business role — household finances live in a separate system by design.
 */
import type { Actor, Role } from "@/lib/core/types";
import { PermissionDeniedError } from "@/lib/core/errors";

export type Permission =
  | "VIEW_FINANCIALS"
  | "VIEW_PAYROLL_DETAIL"
  | "VIEW_SENSITIVE_IDENTIFIERS"
  | "VIEW_AUDIT"
  | "VIEW_HOUSEHOLD"
  | "PROPOSE_ACTIONS"
  | "APPROVE_YELLOW"
  | "APPROVE_RED"
  | "LOCK_PERIOD"
  | "EDIT_CONFIG"
  | "RUN_EVALS"
  | "MANAGE_POLICIES"
  | "MANAGE_CAPABILITIES"
  | "MANAGE_USERS";

export const PERMISSIONS: readonly Permission[] = Object.freeze([
  "VIEW_FINANCIALS",
  "VIEW_PAYROLL_DETAIL",
  "VIEW_SENSITIVE_IDENTIFIERS",
  "VIEW_AUDIT",
  "VIEW_HOUSEHOLD",
  "PROPOSE_ACTIONS",
  "APPROVE_YELLOW",
  "APPROVE_RED",
  "LOCK_PERIOD",
  "EDIT_CONFIG",
  "RUN_EVALS",
  "MANAGE_POLICIES",
  "MANAGE_CAPABILITIES",
  "MANAGE_USERS",
]);

export const ROLES: readonly Role[] = Object.freeze(["OWNER", "FINANCE_OPERATOR", "CPA", "PAYROLL_PROFESSIONAL", "ATTORNEY", "AUDITOR", "VIEWER", "SYSTEM", "AGENT"]);

/** Permissions that are never granted to any role (checked by tests). */
export const NEVER_GRANTED: readonly Permission[] = Object.freeze(["VIEW_HOUSEHOLD"]);

export const PERMISSION_MATRIX: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  OWNER: ["VIEW_FINANCIALS", "VIEW_PAYROLL_DETAIL", "VIEW_SENSITIVE_IDENTIFIERS", "VIEW_AUDIT", "PROPOSE_ACTIONS", "APPROVE_YELLOW", "APPROVE_RED", "LOCK_PERIOD", "EDIT_CONFIG", "RUN_EVALS", "MANAGE_POLICIES", "MANAGE_CAPABILITIES", "MANAGE_USERS"],
  FINANCE_OPERATOR: ["VIEW_FINANCIALS", "VIEW_AUDIT", "PROPOSE_ACTIONS", "APPROVE_YELLOW", "LOCK_PERIOD", "EDIT_CONFIG"],
  CPA: ["VIEW_FINANCIALS", "VIEW_PAYROLL_DETAIL", "VIEW_SENSITIVE_IDENTIFIERS", "VIEW_AUDIT", "APPROVE_RED", "MANAGE_POLICIES"],
  PAYROLL_PROFESSIONAL: ["VIEW_PAYROLL_DETAIL", "VIEW_SENSITIVE_IDENTIFIERS", "VIEW_AUDIT", "APPROVE_RED"],
  ATTORNEY: ["VIEW_FINANCIALS", "VIEW_AUDIT", "APPROVE_RED"],
  AUDITOR: ["VIEW_FINANCIALS", "VIEW_PAYROLL_DETAIL", "VIEW_AUDIT", "RUN_EVALS"],
  VIEWER: ["VIEW_FINANCIALS"],
  SYSTEM: ["VIEW_FINANCIALS", "VIEW_PAYROLL_DETAIL", "VIEW_AUDIT", "PROPOSE_ACTIONS", "RUN_EVALS", "MANAGE_CAPABILITIES"],
  AGENT: ["VIEW_FINANCIALS", "VIEW_PAYROLL_DETAIL", "VIEW_AUDIT", "PROPOSE_ACTIONS"],
});

export function can(role: Role, permission: Permission): boolean {
  if (NEVER_GRANTED.includes(permission)) return false;
  return PERMISSION_MATRIX[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return (PERMISSION_MATRIX[role] ?? []).filter((p) => !NEVER_GRANTED.includes(p));
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) {
    throw new PermissionDeniedError(`${actor.role} (${actor.id}) lacks permission ${permission}`, { actorId: actor.id, role: actor.role, permission });
  }
}

/** Roles allowed to approve at a given risk level (used by UI and approval engine). */
export function approverRolesFor(level: "GREEN" | "YELLOW" | "RED"): Role[] {
  if (level === "GREEN") return [];
  const perm: Permission = level === "YELLOW" ? "APPROVE_YELLOW" : "APPROVE_RED";
  return ROLES.filter((r) => can(r, perm));
}
