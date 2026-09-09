import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { AuthorizationError } from "../auth/authorize";
import { getViewer, type Viewer } from "../auth/session";
import { dollarsToCents } from "../finance/money";

export type ActionResult<T = void> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return viewer;
}

/** Run an action body and convert known failures into a result the form can show. */
export async function runAction<T>(fn: () => Promise<T> | T): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    if (err instanceof AuthorizationError) return { ok: false, error: err.message };
    if (err instanceof ZodError) return { ok: false, error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    if (err instanceof ActionError) return { ok: false, error: err.message };
    // Next.js redirects are thrown as errors and must propagate.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw err;
    console.error(err);
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}

export class ActionError extends Error {}

export function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Empty = unknown (null). Never coerces blanks to zero. */
export function moneyOrNull(fd: FormData, name: string): number | null {
  const v = str(fd, name);
  if (v === "") return null;
  try {
    return dollarsToCents(v);
  } catch {
    throw new ActionError(`"${v}" is not an amount.`);
  }
}

export function moneyRequired(fd: FormData, name: string, label = name): number {
  const v = moneyOrNull(fd, name);
  if (v === null) throw new ActionError(`${label} is required.`);
  return v;
}

export function pctOrNull(fd: FormData, name: string): number | null {
  const v = str(fd, name);
  if (v === "") return null;
  const n = Number(v.replace(/%/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new ActionError(`"${v}" is not a percentage between 0 and 100.`);
  return n;
}

export function intOrNull(fd: FormData, name: string): number | null {
  const v = str(fd, name);
  if (v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ActionError(`"${v}" is not a whole number.`);
  return n;
}
