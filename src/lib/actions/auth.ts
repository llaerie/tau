"use server";

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { defaultAssumptions } from "../assumptions";
import { hashPassword, verifyPassword } from "../auth/password";
import { createSession, destroySession } from "../auth/session";
import { getConfig } from "../config";
import { getDb } from "../db";
import { DEMO } from "../db/seed";
import * as s from "../db/schema";
import { newId, nowIso } from "../ids";
import { applyTemplateRecords, TEMPLATE, templatePerson } from "../db/template";
import { ActionError, runAction, str, type ActionResult } from "./helpers";

/** Demo persona sign-in. Refused outright outside demo mode. */
export async function signInDemo(persona: string): Promise<ActionResult> {
  const result = await runAction(async () => {
    if (getConfig().mode !== "demo") throw new ActionError("Demo sign-in is disabled in live mode.");
    const user = persona === "will" ? DEMO.users.will : persona === "arielle" ? DEMO.users.arielle : null;
    if (!user) throw new ActionError("Unknown demo persona.");
    getDb();
    await createSession(user.id);
  });
  if (result.ok) redirect("/");
  return result;
}

const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function signInWithPassword(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const { email, password } = credentials.parse({ email: str(fd, "email").toLowerCase(), password: str(fd, "password") });
    const db = getDb();
    const user = db.select().from(s.users).where(eq(s.users.email, email)).get();
    if (!user || user.isDemo || !verifyPassword(password, user.passwordHash)) throw new ActionError("Email or password is incorrect.");
    await createSession(user.id);
  });
  if (result.ok) redirect("/");
  return result;
}

const registration = z.object({
  name: z.string().min(1).max(80),
  title: z.string().max(80),
  email: z.string().email().max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  workspaceName: z.string().max(80),
  partnerName: z.string().max(80),
  partnerTitle: z.string().max(80),
  inviteCode: z.string().max(200),
});

/**
 * Create an account. With an invite code the user joins that workspace with the
 * roles the invite carries. Without one, a new workspace is created and the
 * user becomes its owner. Available in live mode; in demo mode the personas
 * are used instead.
 */
export async function register(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    if (getConfig().mode !== "live") throw new ActionError("Registration is only available in live mode. Use a demo persona here.");
    const input = registration.parse({
      name: str(fd, "name"),
      title: str(fd, "title"),
      email: str(fd, "email").toLowerCase(),
      password: str(fd, "password"),
      workspaceName: str(fd, "workspaceName"),
      partnerName: str(fd, "partnerName"),
      partnerTitle: str(fd, "partnerTitle"),
      inviteCode: str(fd, "inviteCode"),
    });
    const db = getDb();
    if (db.select().from(s.users).where(eq(s.users.email, input.email)).get()) throw new ActionError("An account with that email already exists.");
    const createdAt = nowIso();
    const userId = newId("usr");

    db.transaction((tx) => {
      tx.insert(s.users).values({ id: userId, email: input.email, name: input.name, passwordHash: hashPassword(input.password), isDemo: false, createdAt }).run();

      if (input.inviteCode) {
        const invite = tx.select().from(s.invites).where(and(eq(s.invites.code, input.inviteCode), isNull(s.invites.acceptedByUserId))).get();
        if (!invite || invite.expiresAt < createdAt) throw new ActionError("That invite is invalid or has expired.");
        const roles = JSON.parse(invite.spaceRolesJson) as Record<string, "owner" | "editor" | "viewer">;
        tx.insert(s.memberships).values({ id: newId("mem"), workspaceId: invite.workspaceId, userId, role: "member", createdAt }).run();
        // The invite names the person; link (or create) their person record and private personal space.
        let person = tx.select().from(s.persons).where(and(eq(s.persons.workspaceId, invite.workspaceId), eq(s.persons.name, invite.personName))).get();
        if (!person) {
          const personId = newId("per");
          tx.insert(s.persons).values({ id: personId, workspaceId: invite.workspaceId, slug: slugify(invite.personName), name: invite.personName, title: templatePerson(invite.personName)?.title ?? null, userId }).run();
          person = tx.select().from(s.persons).where(eq(s.persons.id, personId)).get()!;
        } else {
          tx.update(s.persons).set({ userId }).where(eq(s.persons.id, person.id)).run();
        }
        let personal = tx.select().from(s.spaces).where(and(eq(s.spaces.workspaceId, invite.workspaceId), eq(s.spaces.personId, person.id))).get();
        if (!personal) {
          const spaceId = newId("sp");
          tx.insert(s.spaces).values({ id: spaceId, workspaceId: invite.workspaceId, kind: "personal", name: person.name, personId: person.id }).run();
          personal = tx.select().from(s.spaces).where(eq(s.spaces.id, spaceId)).get()!;
        }
        tx.insert(s.spacePermissions).values({ id: newId("perm"), spaceId: personal.id, userId, role: "owner" }).onConflictDoNothing().run();
        for (const [spaceId, role] of Object.entries(roles)) {
          const sp = tx.select().from(s.spaces).where(and(eq(s.spaces.id, spaceId), eq(s.spaces.workspaceId, invite.workspaceId))).get();
          if (!sp || sp.kind === "personal") continue; // never grant someone else's personal space through an invite
          tx.insert(s.spacePermissions).values({ id: newId("perm"), spaceId, userId, role }).onConflictDoNothing().run();
        }
        tx.update(s.invites).set({ acceptedByUserId: userId }).where(eq(s.invites.id, invite.id)).run();
        return;
      }

      const workspaceId = newId("ws");
      const companyName = input.workspaceName || TEMPLATE.companyName;
      tx.insert(s.workspaces).values({ id: workspaceId, name: companyName, isDemo: false, createdAt }).run();
      tx.insert(s.memberships).values({ id: newId("mem"), workspaceId, userId, role: "owner", createdAt }).run();
      const me = newId("per");
      tx.insert(s.persons).values({ id: me, workspaceId, slug: slugify(input.name), name: input.name, title: input.title || templatePerson(input.name)?.title || null, userId }).run();
      const personIds = [me];
      let partnerId: string | null = null;
      if (input.partnerName) {
        partnerId = newId("per");
        tx.insert(s.persons).values({ id: partnerId, workspaceId, slug: slugify(input.partnerName), name: input.partnerName, title: input.partnerTitle || templatePerson(input.partnerName)?.title || null, userId: null }).run();
        personIds.push(partnerId);
      }
      const company = newId("sp");
      const household = newId("sp");
      const mine = newId("sp");
      const spaces = [
        { id: company, kind: "company" as const, name: companyName, personId: null },
        { id: household, kind: "household" as const, name: "Household", personId: null },
        { id: mine, kind: "personal" as const, name: input.name, personId: me },
        ...(partnerId ? [{ id: newId("sp"), kind: "personal" as const, name: input.partnerName, personId: partnerId }] : []),
      ];
      tx.insert(s.spaces).values(spaces.map((sp) => ({ ...sp, workspaceId }))).run();
      tx.insert(s.spacePermissions).values([
        { id: newId("perm"), spaceId: company, userId, role: "owner" },
        { id: newId("perm"), spaceId: household, userId, role: "owner" },
        { id: newId("perm"), spaceId: mine, userId, role: "owner" },
      ]).run();
      tx.insert(s.assumptions).values({ workspaceId, json: JSON.stringify(defaultAssumptions(personIds)), updatedAt: createdAt, updatedBy: userId }).run();
      // Bills, budgets and goals from the plan. Personal records apply to people whose name matches the plan.
      applyTemplateRecords(tx, workspaceId, spaces, [{ id: me, name: input.name }, ...(partnerId ? [{ id: partnerId, name: input.partnerName }] : [])]);
    });
    await createSession(userId);
  });
  if (result.ok) redirect("/onboarding");
  return result;
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/sign-in");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || newId("p");
}
