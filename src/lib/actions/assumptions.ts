"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assumptionsSchema, type WorkspaceAssumptions } from "../assumptions";
import { AuthorizationError, canEditAssumptions } from "../auth/authorize";
import { getDb } from "../db";
import * as s from "../db/schema";
import { nowIso } from "../ids";
import { intOrNull, moneyOrNull, pctOrNull, requireViewer, runAction, str, type ActionResult } from "./helpers";

function persist(workspaceId: string, next: WorkspaceAssumptions, userId: string) {
  const parsed = assumptionsSchema.parse(next);
  getDb()
    .insert(s.assumptions)
    .values({ workspaceId, json: JSON.stringify(parsed), updatedAt: nowIso(), updatedBy: userId })
    .onConflictDoUpdate({ target: s.assumptions.workspaceId, set: { json: JSON.stringify(parsed), updatedAt: nowIso(), updatedBy: userId } })
    .run();
  revalidatePath("/", "layout");
}

export async function updateCompanyAssumptions(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const viewer = await requireViewer();
    if (!canEditAssumptions(viewer)) throw new AuthorizationError("You need edit access to the company space to change these.");
    const a = structuredClone(viewer.assumptions);
    a.company = {
      anticipatedRevenueCents: moneyOrNull(fd, "anticipatedRevenue"),
      revenueBasis: str(fd, "revenueBasis") === "contracted" ? "contracted" : "anticipated",
      employeeAllocationCents: moneyOrNull(fd, "employeeAllocation"),
      employeeClassification: assumptionsSchema.shape.company.shape.employeeClassification.parse(str(fd, "employeeClassification") || "unresolved"),
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
    const current = a.owners[personId] ?? { grossSalaryCents: null, withholdingRatePct: null, otherNetIncomeCents: 0, householdContributionCents: null };
    a.owners[personId] = {
      grossSalaryCents: fd.has("grossSalary") ? moneyOrNull(fd, "grossSalary") : current.grossSalaryCents,
      withholdingRatePct: fd.has("withholdingRatePct") ? pctOrNull(fd, "withholdingRatePct") : current.withholdingRatePct,
      otherNetIncomeCents: fd.has("otherNetIncome") ? moneyOrNull(fd, "otherNetIncome") : current.otherNetIncomeCents,
      householdContributionCents: fd.has("householdContribution") ? moneyOrNull(fd, "householdContribution") : current.householdContributionCents,
    };
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

export async function getAssumptionsRow(workspaceId: string) {
  return getDb().select().from(s.assumptions).where(eq(s.assumptions.workspaceId, workspaceId)).get();
}
