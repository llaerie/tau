"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertWorkspaceOwner, AuthorizationError } from "../auth/authorize";
import { getConfig } from "../config";
import { getDb } from "../db";
import { resetDemoWorkspace } from "../db/seed";
import * as s from "../db/schema";
import { newId, nowIso, randomToken } from "../ids";
import { ActionError, requireViewer, runAction, str, type ActionResult } from "./helpers";

const roleSchema = z.enum(["owner", "editor", "viewer"]);

/** Create an invite link. Nothing is sent: the owner shares the link themselves. */
export async function createInvite(_prev: ActionResult<{ code: string }> | undefined, fd: FormData): Promise<ActionResult<{ code: string }>> {
  return runAction(async () => {
    const viewer = await requireViewer();
    assertWorkspaceOwner(viewer);
    const personName = str(fd, "personName");
    if (!personName) throw new ActionError("Enter the person's name.");
    const roles: Record<string, "owner" | "editor" | "viewer"> = {};
    for (const sp of viewer.spaces) {
      if (sp.kind === "personal") continue;
      const role = str(fd, `role:${sp.id}`);
      if (role && role !== "none") roles[sp.id] = roleSchema.parse(role);
    }
    const code = randomToken(24);
    getDb()
      .insert(s.invites)
      .values({
        id: newId("inv"),
        workspaceId: viewer.workspace.id,
        code,
        personName,
        spaceRolesJson: JSON.stringify(roles),
        createdBy: viewer.user.id,
        createdAt: nowIso(),
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      })
      .run();
    revalidatePath("/settings");
    return { code };
  });
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    assertWorkspaceOwner(viewer);
    getDb().delete(s.invites).where(and(eq(s.invites.id, id), eq(s.invites.workspaceId, viewer.workspace.id))).run();
    revalidatePath("/settings");
  });
}

/** Change another member's role on a shared space. Personal spaces stay private to their person. */
export async function setSpaceRole(userId: string, spaceId: string, role: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    assertWorkspaceOwner(viewer);
    const db = getDb();
    const space = db.select().from(s.spaces).where(and(eq(s.spaces.id, spaceId), eq(s.spaces.workspaceId, viewer.workspace.id))).get();
    if (!space) throw new ActionError("Unknown space.");
    if (space.kind === "personal") throw new AuthorizationError("Personal spaces are private and cannot be shared here.");
    const member = db.select().from(s.memberships).where(and(eq(s.memberships.workspaceId, viewer.workspace.id), eq(s.memberships.userId, userId))).get();
    if (!member) throw new ActionError("That person is not a member of this workspace.");
    if (userId === viewer.user.id && role !== "owner") throw new ActionError("You cannot lower your own access.");
    if (role === "none") {
      db.delete(s.spacePermissions).where(and(eq(s.spacePermissions.spaceId, spaceId), eq(s.spacePermissions.userId, userId))).run();
    } else {
      const r = roleSchema.parse(role);
      db.insert(s.spacePermissions)
        .values({ id: newId("perm"), spaceId, userId, role: r })
        .onConflictDoUpdate({ target: [s.spacePermissions.spaceId, s.spacePermissions.userId], set: { role: r } })
        .run();
    }
    revalidatePath("/", "layout");
  });
}

export async function resetDemoData(): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    if (getConfig().mode !== "demo" || !viewer.isDemo) throw new AuthorizationError("Only the demo workspace can be reset.");
    resetDemoWorkspace(getDb());
    revalidatePath("/", "layout");
  });
}

/** Rename the workspace and the company space together. */
export async function renameWorkspace(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    assertWorkspaceOwner(viewer);
    const name = str(fd, "name").slice(0, 80);
    if (!name) throw new ActionError("Enter a name.");
    const db = getDb();
    db.update(s.workspaces).set({ name }).where(eq(s.workspaces.id, viewer.workspace.id)).run();
    db.update(s.spaces).set({ name }).where(and(eq(s.spaces.workspaceId, viewer.workspace.id), eq(s.spaces.kind, "company"))).run();
    revalidatePath("/", "layout");
  });
}
