/** Shared server-page bootstrap: runtime + actor, with a permission check helper. */
import type { Actor } from "@/lib/core/types";
import { getRuntime, type LabRuntime } from "@/lib/db/runtime";
import { can, type Permission } from "@/lib/security/rbac";
import { getActor } from "./session";

export interface PageCtx {
  rt: LabRuntime;
  actor: Actor;
  asOf: string;
}

export async function pageCtx(): Promise<PageCtx> {
  const [rt, actor] = await Promise.all([getRuntime(), getActor()]);
  return { rt, actor, asOf: rt.asOfDate };
}

export function allowed(actor: Actor, permission: Permission): boolean {
  return can(actor.role, permission);
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function sp(value: string | string[] | undefined, fallback = ""): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? fallback;
}
