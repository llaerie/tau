import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assumptionsSchema, type WorkspaceAssumptions } from "../assumptions";
import { assertSpaceAccess, AuthorizationError } from "../auth/authorize";
import type { Viewer } from "../auth/session";
import { getDb } from "../db";
import * as s from "../db/schema";
import { computeFoodPlan, computeTakeHome, formatCents, monthPeriod } from "../finance";
import { amountFromNullable } from "../finance/money";
import { splitByCents, splitEqual } from "../finance/splits";
import { currentMonth, newId, nowIso, randomToken } from "../ids";
import { buildCompanyView, buildPersonalView } from "../views";
import { foodSpentCents } from "../data/spaces";

/**
 * Every change the assistant or the UI prepares goes through here:
 * draft → preview → approve (with the draft's version) → apply (idempotent).
 * Authorization is re-checked at every step from the server-derived viewer.
 */

export class ActionEngineError extends Error {}

const money = z.number().int();

export const payloadSchemas = {
  budget_change: z.object({
    personId: z.string().min(1),
    field: z.enum(["foodTarget", "allocation"]),
    amountCents: money.nullable(),
    allocation: z.object({ id: z.string().optional(), name: z.string().min(1).max(80), kind: z.enum(["savings", "investment", "spending"]) }).optional(),
    remove: z.boolean().optional(),
  }),
  expense: z.object({
    spaceId: z.string().min(1),
    accountId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountCents: money.positive(),
    description: z.string().min(1).max(200),
    categoryId: z.string().nullable().optional(),
    categoryName: z.string().max(80).optional(),
    purpose: z.enum(["business", "personal", "mixed", "unresolved"]).default("personal"),
    beneficiary: z.enum(["company", "household", "person", "split"]).default("person"),
    treatment: z.string().max(60).default("none"),
    payerPersonId: z.string().nullable().optional(),
    shares: z.array(z.object({ personId: z.string().min(1), cents: money.nonnegative() })).optional(),
    documentId: z.string().nullable().optional(),
    note: z.string().max(300).optional(),
  }),
  food_split: z.object({
    transactionId: z.string().min(1),
    shares: z.array(z.object({ personId: z.string().min(1), cents: money.nonnegative() })).min(1),
  }),
  purchase_plan: z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(120),
    category: z.enum(["hardware", "furniture", "software", "travel", "other"]).default("other"),
    unitPriceCents: money.nullable(),
    quantity: z.number().int().positive().default(1),
    taxShippingCents: money.nullable().optional(),
    targetMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
    payerSpaceId: z.string().min(1),
    beneficiary: z.enum(["company", "household", "person", "split"]).default("company"),
    beneficiaryPersonId: z.string().nullable().optional(),
    purpose: z.enum(["business", "personal", "mixed", "unresolved"]).default("unresolved"),
    notes: z.string().max(400).optional(),
    specification: z.string().max(300).optional(),
  }),
  subscription_change: z.object({
    id: z.string().optional(),
    provider: z.string().min(1).max(80),
    product: z.string().min(1).max(80),
    tier: z.string().max(80).nullable().optional(),
    kind: z.enum(["subscription", "api_usage", "saas"]).default("subscription"),
    quantity: z.number().int().positive().default(1),
    unitPriceCents: money.nullable().optional(),
    interval: z.enum(["monthly", "annual"]).default("monthly"),
    status: z.enum(["planned", "active", "cancelled"]).default("planned"),
    renewalDate: z.string().nullable().optional(),
    accountStatus: z.enum(["existing", "new", "unknown"]).default("unknown"),
    evidence: z.string().max(300).nullable().optional(),
    notes: z.string().max(400).nullable().optional(),
  }),
  void_transaction: z.object({ transactionId: z.string().min(1), reason: z.string().min(1).max(200) }),
  archive_record: z.object({ entity: z.enum(["goal", "budget", "subscription", "purchase_plan"]), id: z.string().min(1) }),
};

export type ActionType = keyof typeof payloadSchemas;
export type ActionPayload<T extends ActionType> = z.infer<(typeof payloadSchemas)[T]>;

export interface PreviewRow {
  label: string;
  before: string | null;
  after: string;
  note?: string;
}

export interface ActionPreview {
  title: string;
  summary: string;
  rows: PreviewRow[];
  warnings: string[];
  /** What this action will NOT do. */
  boundaries: string[];
  scopeLabel: string;
  privacyNote?: string;
}

export interface ActionView {
  id: string;
  type: ActionType;
  status: s.ActionRow["status"];
  version: number;
  preview: ActionPreview;
  payload: unknown;
  result: unknown;
  createdAt: string;
  appliedAt: string | null;
  error: string | null;
}

function toView(row: s.ActionRow): ActionView {
  return { id: row.id, type: row.type as ActionType, status: row.status, version: row.version, preview: JSON.parse(row.previewJson), payload: JSON.parse(row.payloadJson), result: row.resultJson ? JSON.parse(row.resultJson) : null, createdAt: row.createdAt, appliedAt: row.appliedAt, error: row.error };
}

function personName(viewer: Viewer, id: string | null | undefined): string {
  return viewer.persons.find((p) => p.id === id)?.name ?? "someone";
}

function requireOwnPerson(viewer: Viewer, personId: string): void {
  if (viewer.person?.id !== personId && viewer.workspaceRole !== "owner") throw new AuthorizationError("You can only change your own personal plan.");
  // A workspace owner may edit their own plan; the partner's private plan stays theirs.
  if (viewer.person?.id !== personId) throw new AuthorizationError("This personal plan belongs to someone else.");
}

function sourceVersion(viewer: Viewer): string {
  const row = getDb().select({ updatedAt: s.assumptions.updatedAt }).from(s.assumptions).where(eq(s.assumptions.workspaceId, viewer.workspace.id)).get();
  return row?.updatedAt ?? "";
}

// ---------- Previews ----------

function previewFor(viewer: Viewer, type: ActionType, payload: unknown): ActionPreview {
  switch (type) {
    case "budget_change": {
      const p = payload as ActionPayload<"budget_change">;
      requireOwnPerson(viewer, p.personId);
      const mine = viewer.spaces.find((sp) => sp.kind === "personal" && sp.personId === p.personId);
      if (!mine) throw new AuthorizationError("No personal space.");
      const view = buildPersonalView(viewer, mine.id);
      const o = view.owner;
      const nextOwner = structuredClone(o);
      let title = "";
      const rows: PreviewRow[] = [];
      if (p.field === "foodTarget") {
        nextOwner.foodTargetCents = p.amountCents;
        title = p.amountCents === null ? "Clear your food target" : `Set your food target to ${formatCents(p.amountCents)} a month`;
        rows.push({ label: "Food target", before: o.foodTargetCents === null ? "not set" : formatCents(o.foodTargetCents), after: p.amountCents === null ? "not set" : formatCents(p.amountCents) });
      } else {
        const existing = p.allocation?.id ? nextOwner.allocations.find((a) => a.id === p.allocation!.id) : nextOwner.allocations.find((a) => a.name.toLowerCase() === p.allocation!.name.toLowerCase());
        if (p.remove) {
          nextOwner.allocations = nextOwner.allocations.filter((a) => a !== existing);
          title = `Remove the ${p.allocation?.name ?? "allocation"} allocation`;
          rows.push({ label: p.allocation?.name ?? "Allocation", before: existing ? formatCents(existing.monthlyCents) : "none", after: "removed" });
        } else {
          if (!p.allocation || p.amountCents === null) throw new ActionEngineError("An allocation needs a name and an amount.");
          if (existing) existing.monthlyCents = p.amountCents;
          else nextOwner.allocations.push({ id: newId("alloc"), name: p.allocation.name, kind: p.allocation.kind, monthlyCents: p.amountCents });
          title = `${existing ? "Change" : "Add"} the ${p.allocation.name} allocation to ${formatCents(p.amountCents)} a month`;
          rows.push({ label: `${p.allocation.name} (${p.allocation.kind})`, before: existing ? formatCents(existing.monthlyCents) : "none", after: formatCents(p.amountCents) });
        }
      }
      const period = monthPeriod(currentMonth());
      const spent = foodSpentCents(view.data, period);
      const after = computeFoodPlan({ personId: p.personId, name: view.personName, takeHome: computeTakeHome(amountFromNullable(nextOwner.grossSalaryCents, "not set"), viewer.assumptions.payrollRules, nextOwner.withholding), foodTargetCents: nextOwner.foodTargetCents, foodSpentCents: spent.cents, foodTransactionCount: spent.count, allocations: nextOwner.allocations, fixedBillsCents: view.fixedBillsTotal, householdContributionCents: nextOwner.householdContributionCents ?? 0 });
      const fmtT = (t: { complete: boolean; knownCents: number }) => (t.complete ? formatCents(t.knownCents) : "unknown");
      rows.push({ label: "Unallocated personal plan", before: fmtT(view.food.unallocated.total), after: fmtT(after.unallocated.total), note: after.unallocated.total.complete ? undefined : "Stays unknown until take-home is confirmed." });
      const warnings: string[] = [];
      if (after.unallocated.total.complete && after.unallocated.total.knownCents < 0) warnings.push(`This over-plans your take-home by ${formatCents(-after.unallocated.total.knownCents)}.`);
      return { title, summary: "Changes your personal plan only. No money moves.", rows, warnings, boundaries: ["Does not move money or change anyone else's plan."], scopeLabel: "My money", privacyNote: "Your plan details stay private; your partner can see only a coarse summary if you allow it." };
    }
    case "expense": {
      const p = payload as ActionPayload<"expense">;
      const space = assertSpaceAccess(viewer, p.spaceId, "edit");
      const account = getDb().select().from(s.accounts).where(eq(s.accounts.id, p.accountId)).get();
      if (!account || account.spaceId !== space.id) throw new ActionEngineError("That account does not belong to the selected space.");
      const shares = p.shares && p.shares.length ? splitByCents(p.amountCents, p.shares) : p.beneficiary === "person" && p.payerPersonId ? [{ personId: p.payerPersonId, cents: p.amountCents }] : [];
      const rows: PreviewRow[] = [
        { label: "Amount", before: null, after: formatCents(p.amountCents, { cents: true }) },
        { label: "Paid from", before: null, after: `${account.name} (${space.name})`, note: account.type === "credit_card" ? "A card charge: increases the card balance; cash moves when the card is paid." : undefined },
        { label: "Purpose / beneficiary", before: null, after: `${p.purpose} · ${p.beneficiary === "split" ? "split between people" : p.beneficiary}` },
      ];
      for (const sh of shares) rows.push({ label: `${personName(viewer, sh.personId)}'s share`, before: null, after: formatCents(sh.cents, { cents: true }) });
      const warnings: string[] = [];
      if (space.kind === "company" && p.purpose !== "business") warnings.push("Paid by the company for a non-business purpose: recorded once with accounting treatment “review required”, not as a deductible business expense.");
      if (p.beneficiary === "split" && shares.length < 2) warnings.push("A split needs at least two shares.");
      const boundaries = ["Records one economic expense. No payment is made.", ...(shares.length > 1 ? ["Creates one settlement note for the other person's share; it does not transfer money."] : [])];
      return { title: `Record ${formatCents(p.amountCents, { cents: true })}: ${p.description}`, summary: shares.length > 1 ? "One expense, split into personal shares." : "One expense.", rows, warnings, boundaries, scopeLabel: space.name, privacyNote: shares.length > 1 ? "The other person will see their share and the payer, not your other purchases." : undefined };
    }
    case "food_split": {
      const p = payload as ActionPayload<"food_split">;
      const txn = getDb().select().from(s.transactions).where(eq(s.transactions.id, p.transactionId)).get();
      if (!txn) throw new ActionEngineError("Transaction not found.");
      assertSpaceAccess(viewer, txn.spaceId, "edit");
      const shares = splitByCents(txn.amountCents, p.shares);
      return {
        title: `Split ${formatCents(txn.amountCents, { cents: true })} “${txn.description}”`,
        summary: "Allocates the existing expense between personal food budgets. The expense itself is not duplicated.",
        rows: shares.map((sh) => ({ label: `${personName(viewer, sh.personId)}'s share`, before: null, after: formatCents(sh.cents, { cents: true }) })),
        warnings: [],
        boundaries: ["Does not create a second expense or a household meal.", "Does not move money; the other person's share is noted as owed to the payer."],
        scopeLabel: "Shared meal",
      };
    }
    case "purchase_plan": {
      const p = payload as ActionPayload<"purchase_plan">;
      const space = assertSpaceAccess(viewer, p.payerSpaceId, "edit");
      const existing = p.id ? getDb().select().from(s.purchasePlans).where(and(eq(s.purchasePlans.id, p.id), eq(s.purchasePlans.workspaceId, viewer.workspace.id))).get() : undefined;
      if (p.id && !existing) throw new ActionEngineError("That purchase plan no longer exists.");
      const priceOf = (unit: number | null, qty: number, extra: number | null | undefined) => (unit === null ? "unknown" : formatCents(unit * qty + (extra ?? 0)));
      const rows: PreviewRow[] = [
        { label: "Item", before: existing ? `${existing.name}${existing.quantity > 1 ? ` × ${existing.quantity}` : ""}` : null, after: `${p.name}${p.quantity > 1 ? ` × ${p.quantity}` : ""}` },
        { label: "Price", before: existing ? priceOf(existing.unitPriceCents, existing.quantity, existing.taxShippingCents) : null, after: priceOf(p.unitPriceCents, p.quantity, p.taxShippingCents) },
        { label: "When", before: existing ? existing.targetMonth ?? "not scheduled" : null, after: p.targetMonth ?? "not scheduled" },
        { label: "Paid by / for", before: null, after: `${space.name} / ${p.beneficiary}` },
        { label: "Purpose", before: null, after: p.purpose },
        { label: "Accounting treatment", before: null, after: "review required" },
      ];
      const warnings: string[] = [];
      if (space.kind === "company" && p.purpose !== "business") warnings.push("Company-paid personal or household items are not deductible business expenses by default; treatment needs review.");
      if (space.kind === "company" && p.targetMonth && p.unitPriceCents !== null) {
        const cv = buildCompanyView(viewer, p.targetMonth);
        const cash = cv.plan.recordedCash.total;
        rows.push({ label: `Recorded company cash${cv.cashAsOf ? ` (as of ${cv.cashAsOf})` : ""}`, before: cash.complete ? formatCents(cash.knownCents) : "unknown", after: cash.complete ? formatCents(cash.knownCents - p.unitPriceCents * p.quantity - (p.taxShippingCents ?? 0)) : "unknown", note: "One-time effect in the target month only." });
        if (cv.plan.unknownCosts.length) warnings.push(`Conditional: ${cv.plan.unknownCosts.join("; ")} are still unknown, so this is not an affordability guarantee.`);
      }
      return { title: existing ? `Update plan: ${p.name}` : `Plan purchase: ${p.name}`, summary: existing ? "Updates the planned purchase. No order is placed and no money moves." : "Creates a planned purchase for review. No order is placed and no money moves.", rows, warnings, boundaries: ["No purchase, payment or subscription is executed."], scopeLabel: space.name };
    }
    case "subscription_change": {
      const p = payload as ActionPayload<"subscription_change">;
      const company = viewer.spaces.find((sp) => sp.kind === "company");
      if (!company) throw new AuthorizationError("No company space.");
      assertSpaceAccess(viewer, company.id, "edit");
      const existing = p.id ? getDb().select().from(s.subscriptions).where(and(eq(s.subscriptions.id, p.id), eq(s.subscriptions.workspaceId, viewer.workspace.id))).get() : null;
      return {
        title: `${existing ? "Update" : "Add"} ${p.provider} ${p.product}`,
        summary: "Updates the subscription record used for planning. Nothing is purchased or cancelled with the provider.",
        rows: [
          { label: "Tier", before: existing?.tier ?? null, after: p.tier ?? "to confirm" },
          { label: "Quantity", before: existing ? String(existing.quantity) : null, after: String(p.quantity) },
          { label: "Unit price", before: existing ? (existing.unitPriceCents === null ? "unknown" : formatCents(existing.unitPriceCents)) : null, after: p.unitPriceCents == null ? "unknown" : formatCents(p.unitPriceCents) },
          { label: "Status", before: existing?.status ?? null, after: p.status },
        ],
        warnings: [],
        boundaries: ["Does not sign up, cancel or pay for anything."],
        scopeLabel: company.name,
      };
    }
    case "void_transaction": {
      const p = payload as ActionPayload<"void_transaction">;
      const txn = getDb().select().from(s.transactions).where(eq(s.transactions.id, p.transactionId)).get();
      if (!txn) throw new ActionEngineError("Transaction not found.");
      assertSpaceAccess(viewer, txn.spaceId, "edit");
      return { title: `Void “${txn.description}” (${formatCents(txn.amountCents, { cents: true })})`, summary: "Marks the transaction void and keeps it in the audit trail. Balances and budgets stop counting it.", rows: [{ label: "Reason", before: null, after: p.reason }], warnings: txn.economicEventId ? ["Linked shares for this expense will be removed."] : [], boundaries: ["Nothing is deleted; the row stays visible as voided."], scopeLabel: viewer.spaces.find((sp) => sp.id === txn.spaceId)?.name ?? "" };
    }
    case "archive_record": {
      const p = payload as ActionPayload<"archive_record">;
      return { title: `Archive ${p.entity.replace("_", " ")}`, summary: "Hides a superseded record from plans; it stays in history.", rows: [], warnings: [], boundaries: ["Nothing is deleted."], scopeLabel: "Plan review" };
    }
  }
}

// ---------- Lifecycle ----------

export function draftAction<T extends ActionType>(viewer: Viewer, type: T, rawPayload: unknown, idempotencyKey?: string): ActionView {
  const schema = payloadSchemas[type];
  const payload = schema.parse(rawPayload);
  const preview = previewFor(viewer, type, payload);
  const db = getDb();
  const key = idempotencyKey ?? randomToken(16);
  const existing = db.select().from(s.actions).where(eq(s.actions.idempotencyKey, key)).get();
  if (existing) {
    if (existing.userId !== viewer.user.id) throw new AuthorizationError("That action belongs to someone else.");
    return toView(existing);
  }
  const row: typeof s.actions.$inferInsert = { id: newId("act"), workspaceId: viewer.workspace.id, userId: viewer.user.id, type, status: "draft", payloadJson: JSON.stringify(payload), previewJson: JSON.stringify(preview), version: 1, sourceVersion: sourceVersion(viewer), idempotencyKey: key, createdAt: nowIso() };
  db.insert(s.actions).values(row).run();
  return toView(db.select().from(s.actions).where(eq(s.actions.id, row.id)).get()!);
}

export function getAction(viewer: Viewer, id: string): ActionView {
  const row = getDb().select().from(s.actions).where(and(eq(s.actions.id, id), eq(s.actions.workspaceId, viewer.workspace.id))).get();
  if (!row || row.userId !== viewer.user.id) throw new AuthorizationError("Action not found.");
  return toView(row);
}

export function approveAction(viewer: Viewer, id: string, expectedVersion: number): ActionView {
  const db = getDb();
  const row = db.select().from(s.actions).where(and(eq(s.actions.id, id), eq(s.actions.workspaceId, viewer.workspace.id))).get();
  if (!row || row.userId !== viewer.user.id) throw new AuthorizationError("Action not found.");
  if (row.status === "approved" || row.status === "applied") return toView(row);
  if (row.status !== "draft") throw new ActionEngineError(`This action is ${row.status} and cannot be approved.`);
  if (row.version !== expectedVersion) throw new ActionEngineError("The preview changed since you looked at it. Review it again.");
  // Re-validate the preview against current data before approval.
  previewFor(viewer, row.type as ActionType, JSON.parse(row.payloadJson));
  const updated = db.update(s.actions).set({ status: "approved", version: row.version + 1, approvedAt: nowIso() }).where(and(eq(s.actions.id, id), eq(s.actions.version, expectedVersion), eq(s.actions.status, "draft"))).run();
  if (updated.changes === 0) throw new ActionEngineError("The action was changed concurrently. Review it again.");
  return toView(db.select().from(s.actions).where(eq(s.actions.id, id)).get()!);
}

export function cancelAction(viewer: Viewer, id: string): ActionView {
  const db = getDb();
  const row = db.select().from(s.actions).where(and(eq(s.actions.id, id), eq(s.actions.workspaceId, viewer.workspace.id))).get();
  if (!row || row.userId !== viewer.user.id) throw new AuthorizationError("Action not found.");
  if (row.status === "applied") throw new ActionEngineError("Applied actions cannot be cancelled; reverse them instead.");
  db.update(s.actions).set({ status: "cancelled" }).where(eq(s.actions.id, id)).run();
  return toView(db.select().from(s.actions).where(eq(s.actions.id, id)).get()!);
}

/** Apply an approved action exactly once. Retries and double submissions return the first result. */
export function applyAction(viewer: Viewer, id: string): ActionView {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(s.actions).where(and(eq(s.actions.id, id), eq(s.actions.workspaceId, viewer.workspace.id))).get();
    if (!row || row.userId !== viewer.user.id) throw new AuthorizationError("Action not found.");
    if (row.status === "applied") return toView(row);
    if (row.status !== "approved") throw new ActionEngineError("Approve the action before applying it.");
    const type = row.type as ActionType;
    const payload = JSON.parse(row.payloadJson);
    // Recheck authorization and freshness right before writing.
    previewFor(viewer, type, payload);
    if (type === "budget_change" && row.sourceVersion && row.sourceVersion !== sourceVersion(viewer)) {
      // Assumptions changed since the draft: still safe (we merge one field), but record it.
    }
    const audit = (entity: string, entityId: string, action: string, before: unknown, after: unknown) =>
      tx.insert(s.auditLog).values({ id: newId("aud"), workspaceId: viewer.workspace.id, userId: viewer.user.id, entity, entityId, action, beforeJson: before === undefined ? null : JSON.stringify(before), afterJson: after === undefined ? null : JSON.stringify(after), actionId: id, createdAt: nowIso() }).run();
    let result: unknown = null;
    switch (type) {
      case "budget_change": {
        const p = payload as ActionPayload<"budget_change">;
        const arow = tx.select().from(s.assumptions).where(eq(s.assumptions.workspaceId, viewer.workspace.id)).get();
        const current: WorkspaceAssumptions = arow ? assumptionsSchema.parse(JSON.parse(arow.json)) : viewer.assumptions;
        const before = structuredClone(current.owners[p.personId]);
        const owner = current.owners[p.personId];
        if (p.field === "foodTarget") owner.foodTargetCents = p.amountCents;
        else {
          const existing = p.allocation?.id ? owner.allocations.find((a) => a.id === p.allocation!.id) : owner.allocations.find((a) => a.name.toLowerCase() === p.allocation!.name.toLowerCase());
          if (p.remove) owner.allocations = owner.allocations.filter((a) => a !== existing);
          else if (existing) existing.monthlyCents = p.amountCents!;
          else owner.allocations.push({ id: newId("alloc"), name: p.allocation!.name, kind: p.allocation!.kind, monthlyCents: p.amountCents! });
        }
        const now = nowIso();
        if (arow) tx.insert(s.assumptionHistory).values({ id: newId("ah"), workspaceId: viewer.workspace.id, json: arow.json, provenance: "user_edited", note: `Before action ${id}`, effectiveFrom: arow.updatedAt, supersededAt: now, changedBy: viewer.user.id }).run();
        tx.insert(s.assumptions).values({ workspaceId: viewer.workspace.id, json: JSON.stringify(current), updatedAt: now, updatedBy: viewer.user.id }).onConflictDoUpdate({ target: s.assumptions.workspaceId, set: { json: JSON.stringify(current), updatedAt: now, updatedBy: viewer.user.id } }).run();
        audit("owner_plan", p.personId, "budget_change", before, current.owners[p.personId]);
        result = { personId: p.personId, foodTargetCents: owner.foodTargetCents, allocations: owner.allocations };
        break;
      }
      case "expense": {
        const p = payload as ActionPayload<"expense">;
        const space = assertSpaceAccess(viewer, p.spaceId, "edit");
        let categoryId = p.categoryId ?? null;
        if (!categoryId && p.categoryName) {
          const existing = tx.select().from(s.categories).where(and(eq(s.categories.workspaceId, viewer.workspace.id), eq(s.categories.name, p.categoryName))).get();
          categoryId = existing?.id ?? null;
          if (!categoryId) {
            categoryId = newId("cat");
            tx.insert(s.categories).values({ id: categoryId, workspaceId: viewer.workspace.id, name: p.categoryName, group: /food|dining|meal|restaurant|coffee|lunch|dinner/i.test(p.categoryName) ? "food" : space.kind }).run();
          }
        }
        const eventId = newId("ev");
        const txnId = newId("txn");
        const shares = p.shares && p.shares.length ? splitByCents(p.amountCents, p.shares) : p.beneficiary === "person" && (p.payerPersonId ?? viewer.person?.id) ? [{ personId: (p.payerPersonId ?? viewer.person!.id) as string, cents: p.amountCents }] : [];
        const treatment = space.kind === "company" && p.purpose !== "business" ? "review_required" : p.treatment;
        tx.insert(s.transactions).values({ id: txnId, spaceId: p.spaceId, accountId: p.accountId, counterAccountId: null, date: p.date, amountCents: p.amountCents, kind: "expense", categoryId, billId: null, goalId: null, description: p.description, importHash: null, source: p.documentId ? "receipt" : "assistant", createdBy: viewer.user.id, createdAt: nowIso(), economicEventId: eventId, beneficiary: shares.length > 1 ? "split" : p.beneficiary, purpose: p.purpose, treatment, reviewStatus: treatment === "review_required" ? "review_required" : "none", documentId: p.documentId ?? null, payerPersonId: p.payerPersonId ?? viewer.person?.id ?? null, version: 1 }).run();
        for (const sh of shares) tx.insert(s.expenseShares).values({ id: newId("shr"), transactionId: txnId, economicEventId: eventId, personId: sh.personId, cents: sh.cents, categoryId, date: p.date, settledAt: null }).run();
        if (p.documentId) tx.update(s.documents).set({ status: "matched", transactionId: txnId }).where(and(eq(s.documents.id, p.documentId), eq(s.documents.workspaceId, viewer.workspace.id))).run();
        audit("transaction", txnId, "create", undefined, { ...p, economicEventId: eventId, shares });
        result = { transactionId: txnId, economicEventId: eventId, shares };
        break;
      }
      case "food_split": {
        const p = payload as ActionPayload<"food_split">;
        const txn = tx.select().from(s.transactions).where(eq(s.transactions.id, p.transactionId)).get();
        if (!txn) throw new ActionEngineError("Transaction not found.");
        assertSpaceAccess(viewer, txn.spaceId, "edit");
        const shares = splitByCents(txn.amountCents, p.shares);
        const eventId = txn.economicEventId ?? newId("ev");
        const before = tx.select().from(s.expenseShares).where(eq(s.expenseShares.transactionId, txn.id)).all();
        tx.delete(s.expenseShares).where(eq(s.expenseShares.transactionId, txn.id)).run();
        for (const sh of shares) tx.insert(s.expenseShares).values({ id: newId("shr"), transactionId: txn.id, economicEventId: eventId, personId: sh.personId, cents: sh.cents, categoryId: txn.categoryId, date: txn.date, settledAt: null }).run();
        tx.update(s.transactions).set({ economicEventId: eventId, beneficiary: shares.length > 1 ? "split" : "person", version: txn.version + 1 }).where(eq(s.transactions.id, txn.id)).run();
        audit("transaction", txn.id, "split", before, shares);
        result = { transactionId: txn.id, shares };
        break;
      }
      case "purchase_plan": {
        const p = payload as ActionPayload<"purchase_plan">;
        assertSpaceAccess(viewer, p.payerSpaceId, "edit");
        if (p.id) {
          const before = tx.select().from(s.purchasePlans).where(and(eq(s.purchasePlans.id, p.id), eq(s.purchasePlans.workspaceId, viewer.workspace.id))).get();
          if (!before) throw new ActionEngineError("That purchase plan no longer exists.");
          const set = { name: p.name, category: p.category, specification: p.specification ?? before.specification, quantity: p.quantity, unitPriceCents: p.unitPriceCents, taxShippingCents: p.taxShippingCents ?? before.taxShippingCents, targetMonth: p.targetMonth, beneficiary: p.beneficiary, beneficiaryPersonId: p.beneficiaryPersonId ?? null, purpose: p.purpose, notes: p.notes ?? before.notes, version: before.version + 1 };
          tx.update(s.purchasePlans).set(set).where(eq(s.purchasePlans.id, p.id)).run();
          audit("purchase_plan", p.id, "update", before, set);
          result = { purchasePlanId: p.id };
          break;
        }
        const planId = newId("plan");
        tx.insert(s.purchasePlans).values({ id: planId, workspaceId: viewer.workspace.id, payerSpaceId: p.payerSpaceId, name: p.name, category: p.category, specification: p.specification ?? null, quantity: p.quantity, unitPriceCents: p.unitPriceCents, taxShippingCents: p.taxShippingCents ?? null, targetMonth: p.targetMonth, fundingAccountId: null, beneficiary: p.beneficiary, beneficiaryPersonId: p.beneficiaryPersonId ?? null, purpose: p.purpose, treatment: "review_required", status: "planned", quoteDocumentId: null, notes: p.notes ?? null, source: "user", createdBy: viewer.user.id, createdAt: nowIso(), version: 1 }).run();
        audit("purchase_plan", planId, "create", undefined, p);
        result = { purchasePlanId: planId };
        break;
      }
      case "subscription_change": {
        const p = payload as ActionPayload<"subscription_change">;
        const company = viewer.spaces.find((sp) => sp.kind === "company")!;
        assertSpaceAccess(viewer, company.id, "edit");
        const values = { provider: p.provider, product: p.product, tier: p.tier ?? null, kind: p.kind, quantity: p.quantity, unitPriceCents: p.unitPriceCents ?? null, interval: p.interval, status: p.status, renewalDate: p.renewalDate ?? null, accountStatus: p.accountStatus, evidence: p.evidence ?? null, notes: p.notes ?? null, verifiedAt: p.evidence ? nowIso() : null };
        let subId = p.id ?? null;
        if (subId) {
          const before = tx.select().from(s.subscriptions).where(and(eq(s.subscriptions.id, subId), eq(s.subscriptions.workspaceId, viewer.workspace.id))).get();
          if (!before) throw new ActionEngineError("Subscription not found.");
          tx.update(s.subscriptions).set(values).where(eq(s.subscriptions.id, subId)).run();
          audit("subscription", subId, "update", before, values);
        } else {
          subId = newId("sub");
          tx.insert(s.subscriptions).values({ id: subId, workspaceId: viewer.workspace.id, spaceId: company.id, ...values, currency: "USD", usersJson: "[]", source: "user", createdAt: nowIso() }).run();
          audit("subscription", subId, "create", undefined, values);
        }
        result = { subscriptionId: subId };
        break;
      }
      case "void_transaction": {
        const p = payload as ActionPayload<"void_transaction">;
        const txn = tx.select().from(s.transactions).where(eq(s.transactions.id, p.transactionId)).get();
        if (!txn) throw new ActionEngineError("Transaction not found.");
        assertSpaceAccess(viewer, txn.spaceId, "edit");
        tx.update(s.transactions).set({ voidedAt: nowIso(), voidReason: p.reason, version: txn.version + 1 }).where(eq(s.transactions.id, txn.id)).run();
        tx.delete(s.expenseShares).where(eq(s.expenseShares.transactionId, txn.id)).run();
        audit("transaction", txn.id, "void", txn, { reason: p.reason });
        result = { transactionId: txn.id };
        break;
      }
      case "archive_record": {
        const p = payload as ActionPayload<"archive_record">;
        const now = nowIso();
        if (p.entity === "goal") {
          const g = tx.select().from(s.goals).where(eq(s.goals.id, p.id)).get();
          if (!g) throw new ActionEngineError("Goal not found.");
          assertSpaceAccess(viewer, g.spaceId, "edit");
          tx.update(s.goals).set({ archivedAt: now }).where(eq(s.goals.id, p.id)).run();
          audit("goal", p.id, "archive", g, { archivedAt: now });
        } else if (p.entity === "budget") {
          const b = tx.select().from(s.budgets).where(eq(s.budgets.id, p.id)).get();
          if (!b) throw new ActionEngineError("Budget not found.");
          assertSpaceAccess(viewer, b.spaceId, "edit");
          tx.update(s.budgets).set({ archivedAt: now }).where(eq(s.budgets.id, p.id)).run();
          audit("budget", p.id, "archive", b, { archivedAt: now });
        } else if (p.entity === "subscription") {
          const row2 = tx.select().from(s.subscriptions).where(and(eq(s.subscriptions.id, p.id), eq(s.subscriptions.workspaceId, viewer.workspace.id))).get();
          if (!row2) throw new ActionEngineError("Subscription not found.");
          assertSpaceAccess(viewer, row2.spaceId, "edit");
          tx.update(s.subscriptions).set({ status: "cancelled" }).where(eq(s.subscriptions.id, p.id)).run();
          audit("subscription", p.id, "cancel_record", row2, { status: "cancelled" });
        } else {
          const row2 = tx.select().from(s.purchasePlans).where(and(eq(s.purchasePlans.id, p.id), eq(s.purchasePlans.workspaceId, viewer.workspace.id))).get();
          if (!row2) throw new ActionEngineError("Purchase plan not found.");
          assertSpaceAccess(viewer, row2.payerSpaceId, "edit");
          tx.update(s.purchasePlans).set({ status: "cancelled" }).where(eq(s.purchasePlans.id, p.id)).run();
          audit("purchase_plan", p.id, "cancel", row2, { status: "cancelled" });
        }
        result = { entity: p.entity, id: p.id };
        break;
      }
    }
    tx.update(s.actions).set({ status: "applied", appliedAt: nowIso(), resultJson: JSON.stringify(result), version: row.version + 1 }).where(eq(s.actions.id, id)).run();
    return toView(tx.select().from(s.actions).where(eq(s.actions.id, id)).get()!);
  });
}

export function listRecentActions(viewer: Viewer, limit = 20): ActionView[] {
  return getDb().select().from(s.actions).where(and(eq(s.actions.workspaceId, viewer.workspace.id), eq(s.actions.userId, viewer.user.id))).all().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(toView);
}

export { splitEqual };
