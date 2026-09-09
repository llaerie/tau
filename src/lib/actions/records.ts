"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSpaceAccess } from "../auth/authorize";
import { getDb } from "../db";
import * as s from "../db/schema";
import { newId, nowIso } from "../ids";
import { ActionError, intOrNull, moneyOrNull, moneyRequired, requireViewer, runAction, str, type ActionResult } from "./helpers";

// ---------- Accounts ----------

const accountSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().min(1).max(80),
  type: z.enum(["checking", "savings", "credit_card", "cash", "other"]),
  institution: z.string().max(80).nullable(),
  openingBalanceCents: z.number().int().nullable(),
  openingBalanceAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function saveAccount(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const id = str(fd, "id");
    const input = accountSchema.parse({
      spaceId: str(fd, "spaceId"),
      name: str(fd, "name"),
      type: str(fd, "type"),
      institution: str(fd, "institution") || null,
      openingBalanceCents: moneyOrNull(fd, "openingBalance"),
      openingBalanceAsOf: str(fd, "openingBalanceAsOf") || null,
    });
    assertSpaceAccess(viewer, input.spaceId, "edit");
    if (input.openingBalanceCents !== null && !input.openingBalanceAsOf) throw new ActionError("Enter the date the balance was taken.");
    const db = getDb();
    if (id) {
      const existing = db.select().from(s.accounts).where(eq(s.accounts.id, id)).get();
      if (!existing) throw new ActionError("Account not found.");
      assertSpaceAccess(viewer, existing.spaceId, "edit");
      db.update(s.accounts).set({ ...input, spaceId: existing.spaceId }).where(eq(s.accounts.id, id)).run();
    } else {
      db.insert(s.accounts).values({ ...input, id: newId("acc") }).run();
    }
    revalidatePath("/", "layout");
  });
}

export async function archiveAccount(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const db = getDb();
    const acc = db.select().from(s.accounts).where(eq(s.accounts.id, id)).get();
    if (!acc) throw new ActionError("Account not found.");
    assertSpaceAccess(viewer, acc.spaceId, "edit");
    db.update(s.accounts).set({ isArchived: !acc.isArchived }).where(eq(s.accounts.id, id)).run();
    revalidatePath("/", "layout");
  });
}

// ---------- Bills ----------

const billSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().min(1).max(80),
  amountCents: z.number().int().nonnegative().nullable(),
  cadence: z.enum(["weekly", "monthly", "quarterly", "annual", "one_time"]),
  dueDay: z.number().int().min(1).max(31).nullable(),
  categoryId: z.string().nullable(),
});

export async function saveBill(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const id = str(fd, "id");
    const input = billSchema.parse({
      spaceId: str(fd, "spaceId"),
      name: str(fd, "name"),
      amountCents: moneyOrNull(fd, "amount"),
      cadence: str(fd, "cadence") || "monthly",
      dueDay: intOrNull(fd, "dueDay"),
      categoryId: str(fd, "categoryId") || null,
    });
    assertSpaceAccess(viewer, input.spaceId, "edit");
    const db = getDb();
    if (id) {
      const existing = db.select().from(s.bills).where(eq(s.bills.id, id)).get();
      if (!existing) throw new ActionError("Bill not found.");
      assertSpaceAccess(viewer, existing.spaceId, "edit");
      db.update(s.bills).set({ ...input, spaceId: existing.spaceId }).where(eq(s.bills.id, id)).run();
    } else {
      db.insert(s.bills).values({ ...input, id: newId("bill"), isActive: true }).run();
    }
    revalidatePath("/", "layout");
  });
}

export async function deleteBill(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const db = getDb();
    const bill = db.select().from(s.bills).where(eq(s.bills.id, id)).get();
    if (!bill) throw new ActionError("Bill not found.");
    assertSpaceAccess(viewer, bill.spaceId, "edit");
    db.update(s.bills).set({ isActive: false }).where(eq(s.bills.id, id)).run();
    revalidatePath("/", "layout");
  });
}

// ---------- Goals ----------

const goalSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().min(1).max(80),
  monthlyTargetCents: z.number().int().nonnegative().nullable(),
  priority: z.number().int().min(1).max(99),
  targetTotalCents: z.number().int().nonnegative().nullable(),
  savedCents: z.number().int().nonnegative(),
  rule: z.string().max(200).nullable(),
});

export async function saveGoal(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const id = str(fd, "id");
    const input = goalSchema.parse({
      spaceId: str(fd, "spaceId"),
      name: str(fd, "name"),
      monthlyTargetCents: moneyOrNull(fd, "monthlyTarget"),
      priority: intOrNull(fd, "priority") ?? 1,
      targetTotalCents: moneyOrNull(fd, "targetTotal"),
      savedCents: moneyOrNull(fd, "saved") ?? 0,
      rule: str(fd, "rule") || null,
    });
    assertSpaceAccess(viewer, input.spaceId, "edit");
    const db = getDb();
    if (id) {
      const existing = db.select().from(s.goals).where(eq(s.goals.id, id)).get();
      if (!existing) throw new ActionError("Goal not found.");
      assertSpaceAccess(viewer, existing.spaceId, "edit");
      db.update(s.goals).set({ ...input, spaceId: existing.spaceId }).where(eq(s.goals.id, id)).run();
    } else {
      db.insert(s.goals).values({ ...input, id: newId("goal"), accountId: null }).run();
    }
    revalidatePath("/", "layout");
  });
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const db = getDb();
    const goal = db.select().from(s.goals).where(eq(s.goals.id, id)).get();
    if (!goal) throw new ActionError("Goal not found.");
    assertSpaceAccess(viewer, goal.spaceId, "edit");
    db.delete(s.goals).where(eq(s.goals.id, id)).run();
    revalidatePath("/", "layout");
  });
}

// ---------- Scenarios ----------

const scenarioSchema = z.object({
  spaceId: z.string().min(1),
  name: z.string().min(1).max(80),
  amountCents: z.number().int().positive(),
  kind: z.enum(["one_time", "recurring"]),
  recurringMonths: z.number().int().min(1).max(120).nullable(),
  startMonthOffset: z.number().int().min(0).max(24),
});

export async function saveScenario(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const input = scenarioSchema.parse({
      spaceId: str(fd, "spaceId"),
      name: str(fd, "name"),
      amountCents: moneyRequired(fd, "amount", "Amount"),
      kind: str(fd, "kind") || "one_time",
      recurringMonths: str(fd, "kind") === "recurring" ? intOrNull(fd, "recurringMonths") : null,
      startMonthOffset: intOrNull(fd, "startMonthOffset") ?? 0,
    });
    assertSpaceAccess(viewer, input.spaceId, "view");
    getDb().insert(s.scenarios).values({ ...input, id: newId("scn"), workspaceId: viewer.workspace.id, createdBy: viewer.user.id, createdAt: nowIso() }).run();
    revalidatePath("/scenarios");
  });
}

export async function deleteScenario(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const db = getDb();
    const sc = db.select().from(s.scenarios).where(eq(s.scenarios.id, id)).get();
    if (!sc || sc.workspaceId !== viewer.workspace.id) throw new ActionError("Scenario not found.");
    assertSpaceAccess(viewer, sc.spaceId, "view");
    db.delete(s.scenarios).where(eq(s.scenarios.id, id)).run();
    revalidatePath("/scenarios");
  });
}
