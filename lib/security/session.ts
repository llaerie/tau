/**
 * Minimal signed-cookie sessions (HMAC-SHA256 over a base64url JSON payload).
 *
 * Lab mode: a missing token resolves to the default OWNER actor so the single-user lab
 * works without a login flow. Full mode (TAU_AUTH_MODE=full, or the default once
 * `.tau/users.json` holds a user — see ./auth-mode) requires a valid token signed with
 * TAU_SESSION_SECRET (or, when unset, a random secret persisted to `.tau/session-secret`).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Actor, Role } from "@/lib/core/types";
import { ControlViolationError } from "@/lib/core/errors";
import { getSecret } from "./secrets";
import { ROLES } from "./rbac";
import { resolveAuthMode } from "./auth-mode";

export const SESSION_COOKIE_NAME = "tau_session";
export const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const LAB_FALLBACK_SECRET = "tau-lab-insecure-dev-secret";

export const LAB_DEFAULT_ACTOR: Readonly<Actor> = Object.freeze({ type: "USER", id: "owner", role: "OWNER", displayName: "Lab Owner" });

export interface SessionPayload {
  actor: Actor;
  /** issued at (unix seconds) */
  iat: number;
  /** expires at (unix seconds) */
  exp: number;
}

export type SessionVerification = { ok: true; payload: SessionPayload } | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "INVALID_ACTOR" };

export function isLabMode(): boolean {
  return resolveAuthMode() === "lab";
}

/** Full mode without TAU_SESSION_SECRET: generate one once and keep it in `.tau/session-secret` (0600). */
function persistedSecretPath(): string {
  const override = process.env.TAU_SESSION_SECRET_FILE;
  return override && override.trim() !== "" ? resolve(override) : resolve(process.cwd(), ".tau", "session-secret");
}

let persistedSecret: string | undefined;

function persistedSessionSecret(): string {
  if (persistedSecret) return persistedSecret;
  const path = persistedSecretPath();
  if (existsSync(path)) {
    const v = readFileSync(path, "utf8").trim();
    if (v.length >= 32) return (persistedSecret = v);
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    const v = randomBytes(32).toString("hex");
    writeFileSync(path, `${v}\n`, { mode: 0o600 });
    return (persistedSecret = v);
  } catch {
    throw new ControlViolationError("TAU_SESSION_SECRET must be set when TAU_AUTH_MODE=full (could not persist a generated secret)");
  }
}

function sessionSecret(): string {
  const s = getSecret("TAU_SESSION_SECRET");
  if (s) return s;
  if (isLabMode()) return LAB_FALLBACK_SECRET;
  return persistedSessionSecret();
}

const b64u = (buf: Buffer | string): string => Buffer.from(buf).toString("base64url");
const unb64u = (s: string): Buffer => Buffer.from(s, "base64url");

function sign(data: string): string {
  return b64u(createHmac("sha256", sessionSecret()).update(data).digest());
}

function isActor(v: unknown): v is Actor {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (a.type === "USER" || a.type === "AGENT" || a.type === "SYSTEM") && typeof a.id === "string" && a.id.length > 0 && ROLES.includes(a.role as Role);
}

export function createSessionToken(actor: Actor, opts: { ttlSeconds?: number; now?: () => number } = {}): string {
  if (!isActor(actor)) throw new ControlViolationError("Cannot create a session for an invalid actor");
  const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  const payload: SessionPayload = { actor: { type: actor.type, id: actor.id, role: actor.role, displayName: actor.displayName }, iat: nowSec, exp: nowSec + (opts.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS) };
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined | null, opts: { now?: () => number } = {}): SessionVerification {
  if (!token || typeof token !== "string") return { ok: false, reason: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "MALFORMED" };
  const [body, sig] = parts;
  const expected = sign(body);
  const a = unb64u(sig);
  const b = unb64u(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "BAD_SIGNATURE" };
  let payload: SessionPayload;
  try {
    payload = JSON.parse(unb64u(body).toString("utf8")) as SessionPayload;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (!isActor(payload.actor) || typeof payload.exp !== "number") return { ok: false, reason: "INVALID_ACTOR" };
  const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  if (payload.exp <= nowSec) return { ok: false, reason: "EXPIRED" };
  return { ok: true, payload };
}

/** Resolve the acting user from a token. Lab mode falls back to the default OWNER when no token is present. */
export function resolveActor(token: string | undefined | null, opts: { now?: () => number } = {}): Actor {
  if (!token) {
    if (isLabMode()) return { ...LAB_DEFAULT_ACTOR };
    throw new ControlViolationError("No session token");
  }
  const v = verifySessionToken(token, opts);
  if (!v.ok) throw new ControlViolationError(`Invalid session: ${v.reason}`, { reason: v.reason });
  return v.payload.actor;
}

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookieValue(cookieHeader: string | null | undefined): string | undefined {
  return parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME];
}

export function serializeSessionCookie(token: string, opts: { maxAgeSeconds?: number; secure?: boolean } = {}): string {
  const parts = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  parts.push(`Max-Age=${opts.maxAgeSeconds ?? DEFAULT_SESSION_TTL_SECONDS}`);
  if (opts.secure ?? process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
