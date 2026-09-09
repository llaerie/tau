import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { getConfig } from "../config";
import { getDb } from "../db";
import * as s from "../db/schema";
import { newId, nowIso, randomToken } from "../ids";
import { parseAssumptions, type WorkspaceAssumptions } from "../assumptions";

export const SESSION_COOKIE = "fd_session";
const SESSION_DAYS = 14;

export type SpaceRole = "owner" | "editor" | "viewer";

export interface ViewerSpace {
  id: string;
  kind: "company" | "household" | "personal";
  name: string;
  personId: string | null;
  role: SpaceRole;
}

export interface Viewer {
  user: s.User;
  workspace: s.Workspace;
  workspaceRole: "owner" | "member";
  persons: s.Person[];
  /** The viewer's own person record, when one exists. */
  person: s.Person | null;
  /** Only the spaces this viewer may see. */
  spaces: ViewerSpace[];
  assumptions: WorkspaceAssumptions;
  isDemo: boolean;
}

/**
 * Secret used to sign the session cookie. In live mode this is AUTH_SECRET.
 * In demo mode we generate one per database so sessions survive restarts
 * without requiring configuration.
 */
function signingSecret(): string {
  const config = getConfig();
  if (config.authSecret) return config.authSecret;
  const db = getDb();
  const row = db.select().from(s.meta).where(eq(s.meta.key, "demo_session_secret")).get();
  if (row) return row.value;
  const value = randomToken(48);
  db.insert(s.meta).values({ key: "demo_session_secret", value }).onConflictDoNothing().run();
  return db.select().from(s.meta).where(eq(s.meta.key, "demo_session_secret")).get()!.value;
}

function sign(sessionId: string): string {
  return createHmac("sha256", signingSecret()).update(sessionId).digest("base64url");
}

function verifyCookie(value: string | undefined): string | null {
  if (!value) return null;
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export async function createSession(userId: string): Promise<void> {
  const db = getDb();
  const id = newId("ses");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.insert(s.sessions).values({ id, userId, expiresAt, createdAt: nowIso() }).run();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.FINANCE_DESK_INSECURE_COOKIES !== "1",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = verifyCookie(jar.get(SESSION_COOKIE)?.value);
  if (id) getDb().delete(s.sessions).where(eq(s.sessions.id, id)).run();
  jar.delete(SESSION_COOKIE);
}

/** Resolve the signed-in user, or null. Cached per request. */
export const getSessionUser = cache(async (): Promise<s.User | null> => {
  const jar = await cookies();
  const id = verifyCookie(jar.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const db = getDb();
  const row = db
    .select({ user: s.users })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.users.id, s.sessions.userId))
    .where(and(eq(s.sessions.id, id), gt(s.sessions.expiresAt, nowIso())))
    .get();
  if (!row) return null;
  // Demo users must never authenticate in live mode, even with a valid cookie.
  if (row.user.isDemo && getConfig().mode !== "demo") return null;
  return row.user;
});

/** Build the viewer: user + workspace + only the spaces they may see. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const db = getDb();
  const membership = db.select().from(s.memberships).where(eq(s.memberships.userId, user.id)).get();
  if (!membership) return null;
  const workspace = db.select().from(s.workspaces).where(eq(s.workspaces.id, membership.workspaceId)).get();
  if (!workspace) return null;
  if (workspace.isDemo && getConfig().mode !== "demo") return null;

  const persons = db.select().from(s.persons).where(eq(s.persons.workspaceId, workspace.id)).all();
  const perms = db.select().from(s.spacePermissions).where(eq(s.spacePermissions.userId, user.id)).all();
  const permBySpace = new Map(perms.map((p) => [p.spaceId, p.role]));
  const allSpaces = db.select().from(s.spaces).where(eq(s.spaces.workspaceId, workspace.id)).all();
  const spaces: ViewerSpace[] = allSpaces
    .filter((sp) => permBySpace.has(sp.id))
    .map((sp) => ({ id: sp.id, kind: sp.kind, name: sp.name, personId: sp.personId, role: permBySpace.get(sp.id)! }))
    .sort((a, b) => order(a.kind) - order(b.kind) || a.name.localeCompare(b.name));

  const arow = db.select().from(s.assumptions).where(eq(s.assumptions.workspaceId, workspace.id)).get();
  const assumptions = parseAssumptions(arow?.json ?? "{}", persons.map((p) => p.id));

  return {
    user,
    workspace,
    workspaceRole: membership.role,
    persons,
    person: persons.find((p) => p.userId === user.id) ?? null,
    spaces,
    assumptions,
    isDemo: workspace.isDemo,
  };
});

function order(kind: string): number {
  return kind === "company" ? 0 : kind === "household" ? 1 : 2;
}
