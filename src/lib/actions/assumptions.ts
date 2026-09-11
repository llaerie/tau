"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { allocationKindSchema, assumptionsSchema, defaultOwnerAssumptions, type WorkspaceAssumptions } from "../assumptions";
import { AuthorizationError, canEditAssumptions } from "../auth/authorize";
import { getDb } from "../db";
import * as s from "../db/schema";
import { newId, nowIso } from "../ids";
import { ActionError, intOrNull, moneyOrNull, pctOrNull, requireViewer, runAction, str, type ActionResult } from "./helpers";
import { dollarsToCents } from "../finance/money";

function persist(workspaceId: string, next: WorkspaceAssumptions, userId: string) {
  const parsed = assumptionsSchema.parse(next);
  getDb()
    .insert(s.assumptions)
    .values({ workspaceId, json: JSON.stringify(parsed), updatedAt: nowIso(), updatedBy: userId })
    .onConflictDoUpdate({ target: s.assumptions.workspaceId, set: { json: JSON.stringify(parsed), updatedAt: nowIso(), updatedBy: userId } })
    .run();
  revalidatePath("/", "layout");
}

function parseMoney(v: string): number {
  try {
    return dollarsToCents(v);
  } catch {
    throw new ActionError(`"${v}" is not an amount.`);
  }
}

/** Allocation rows arrive as alloc.<index>.<field>; blank names are dropped. */
function parseAllocations(fd: FormData) {
  const rows = new Map<number, Record<string, string>>();
  for (const [key, value] of fd.entries()) {
    const m = key.match(/^alloc\.(\d+)\.(id|name|amount|kind|note)$/);
    if (!m || typeof value !== "string") continue;
    const row = rows.get(Number(m[1])) ?? {};
    row[m[2]] = value.trim();
    rows.set(Number(m[1]), row);
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, r]) => r)
    .filter((r) => r.name)
    .map((r) => ({
      id: r.id || newId("al"),
      name: r.name.slice(0, 80),
      amountCents: r.amount ? parseMoney(r.amount) : null,
      kind: allocationKindSchema.parse(r.kind || "mixed"),
      note: r.note ? r.note.slice(0, 300) : undefined,
    }));
}

export async function updateCompanyAssumptions(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const viewer = await requireViewer();
    if (!canEditAssumptions(viewer)) throw new AuthorizationError("You need edit access to the company space to change these.");
    const a = structuredClone(viewer.assumptions);
    a.company = {
      anticipatedRevenueCents: moneyOrNull(fd, "anticipatedRevenue"),
      revenueBasis: str(fd, "revenueBasis") === "contracted" ? "contracted" : "anticipated",
      allocations: fd.has("alloc.0.name") || fd.has("allocationsPresent") ? parseAllocations(fd) : a.company.allocations,
      employerPayrollCostRatePct: pctOrNull(fd, "employerPayrollCostRatePct"),
      incomeTaxReserveRatePct: pctOrNull(fd, "incomeTaxReserveRatePct"),
      otherOverheadCents: moneyOrNull(fd, "otherOverhead"),
      cashReserveTargetMonths: intOrNull(fd, "cashReserveTargetMonths"),
    };
    a.household.plannedCompanyDistributionCents = moneyOrNull(fd, "plannedCompanyDistribution");
    a.notes = str(fd, "notes").slice(0, 4000);
    if (str(fd, "completeOnboarding") === "1") a.onboardingCompleted = true;
    persist(viewer.workspace.id, a, viewer.user.id);
  });
  if (result.ok && str(fd, "completeOnboarding") === "1") redirect("/");
  return result;
}

/** Owner-level fields. A person may edit their own; workspace owners may edit anyone's. */
export async function updateOwnerAssumptions(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const personId = str(fd, "personId");
    const person = viewer.persons.find((p) => p.id === personId);
    if (!person) throw new AuthorizationError("Unknown person.");
    const isSelf = person.userId === viewer.user.id;
    if (!isSelf && viewer.workspaceRole !== "owner") throw new AuthorizationError("Only that person or a workspace owner can change these.");
    const a = structuredClone(viewer.assumptions);
    const current = a.owners[personId] ?? defaultOwnerAssumptions();
    a.owners[personId] = {
      grossSalaryCents: fd.has("grossSalary") ? moneyOrNull(fd, "grossSalary") : current.grossSalaryCents,
      withholding: {
        ficaRatePct: fd.has("ficaRatePct") ? pctOrNull(fd, "ficaRatePct") : current.withholding.ficaRatePct,
        incomeTaxCents: fd.has("incomeTax") ? moneyOrNull(fd, "incomeTax") : current.withholding.incomeTaxCents,
        incomeTaxLowCents: fd.has("incomeTaxLow") ? moneyOrNull(fd, "incomeTaxLow") : current.withholding.incomeTaxLowCents,
        incomeTaxHighCents: fd.has("incomeTaxHigh") ? moneyOrNull(fd, "incomeTaxHigh") : current.withholding.incomeTaxHighCents,
      },
      otherNetIncomeCents: fd.has("otherNetIncome") ? moneyOrNull(fd, "otherNetIncome") : current.otherNetIncomeCents,
      householdContributionCents: fd.has("householdContribution") ? moneyOrNull(fd, "householdContribution") : current.householdContributionCents,
    };
    if (fd.has("title")) {
      getDb().update(s.persons).set({ title: str(fd, "title").slice(0, 80) || null }).where(eq(s.persons.id, personId)).run();
    }
    persist(viewer.workspace.id, a, viewer.user.id);
  });
}

export async function completeOnboarding(): Promise<ActionResult> {
  return runAction(async () => {
    const viewer = await requireViewer();
    const a = structuredClone(viewer.assumptions);
    a.onboardingCompleted = true;
    persist(viewer.workspace.id, a, viewer.user.id);
  });
}

