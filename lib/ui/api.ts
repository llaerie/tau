/**
 * Route-handler helpers: JSON responses, actor resolution, RBAC, and error mapping.
 * Errors never leak stack traces; no financial data is logged.
 */
import { NextResponse } from "next/server";
import type { Actor } from "@/lib/core/types";
import { TauError, PermissionDeniedError, ControlViolationError, ApprovalRequiredError, PeriodLockedError, UnbalancedEntryError, UnknownInformationError } from "@/lib/core/errors";
import { requirePermission, type Permission } from "@/lib/security/rbac";
import { actorFromRequest } from "./session";

export type ApiHandler<Ctx = unknown> = (req: Request, ctx: Ctx, actor: Actor) => Promise<Response> | Response;

export function json(data: unknown, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}

export function apiError(message: string, status = 400, code = "BAD_REQUEST", details?: Record<string, unknown>): Response {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

const CODE_STATUS: Record<string, number> = {
  PERMISSION_DENIED: 403,
  APPROVAL_REQUIRED: 409,
  PERIOD_LOCKED: 409,
  CONTROL_VIOLATION: 409,
  UNBALANCED_ENTRY: 422,
  INSUFFICIENT_INFORMATION: 422,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  NULL_VALUE: 422,
  UNKNOWN_KEY: 400,
  INVALID_STATE: 409,
};

/**
 * Map a thrown error to an HTTP status. Duck-typed on `code` (TauError family) rather than
 * `instanceof`, because dev-mode on-demand compilation can give routes their own module
 * instances of lib/core/errors while the runtime singleton was built by another graph.
 */
function statusFor(err: unknown): { status: number; code: string } {
  if (err instanceof PermissionDeniedError) return { status: 403, code: "PERMISSION_DENIED" };
  if (err instanceof ApprovalRequiredError) return { status: 409, code: "APPROVAL_REQUIRED" };
  if (err instanceof PeriodLockedError) return { status: 409, code: "PERIOD_LOCKED" };
  if (err instanceof UnbalancedEntryError) return { status: 422, code: "UNBALANCED_ENTRY" };
  if (err instanceof UnknownInformationError) return { status: 422, code: "INSUFFICIENT_INFORMATION" };
  if (err instanceof ControlViolationError) return { status: 409, code: "CONTROL_VIOLATION" };
  if (err instanceof TauError) return { status: CODE_STATUS[err.code] ?? 400, code: err.code };
  if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string") {
    const code = (err as { code: string }).code;
    const name = String((err as { name?: unknown }).name ?? "");
    if (CODE_STATUS[code] !== undefined) return { status: CODE_STATUS[code], code };
    if (name === "TauError" || name.endsWith("Error")) return { status: 400, code };
  }
  return { status: 500, code: "INTERNAL" };
}

/** Wrap a handler: resolves the actor, checks an optional permission and maps errors to JSON. */
export function withApi<Ctx = unknown>(handler: ApiHandler<Ctx>, permission?: Permission): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    let actor: Actor;
    try {
      actor = actorFromRequest(req);
    } catch {
      return apiError("Invalid or missing session", 401, "UNAUTHENTICATED");
    }
    try {
      if (permission) requirePermission(actor, permission);
      return await handler(req, ctx, actor);
    } catch (err) {
      const { status, code } = statusFor(err);
      const message = err instanceof Error ? err.message : "Request failed";
      if (status === 500) console.error(`[api] ${new URL(req.url).pathname} failed: ${code}`);
      return apiError(status === 500 ? "Internal error" : message, status, code);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    throw new TauError("BAD_REQUEST", "Body must be valid JSON");
  }
}

export function str(v: unknown, fallback?: string): string {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (fallback !== undefined) return fallback;
  throw new TauError("BAD_REQUEST", "Missing required string field");
}
