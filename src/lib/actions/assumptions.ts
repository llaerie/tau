"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assumptionsSchema, defaultOwnerAssumptions, type WorkspaceAssumptions } from "../assumptions";
import { AuthorizationError, canEditAssumptions } from "../auth/authorize";
import { getDb } from "../db";
import * as s from "../db/schema";
import { newId, nowIso } from "../ids";
import { intOrNull, moneyOrNull, pctOrNull, requireViewer, runAction, str, type ActionResult } from "./helpers";

function persist(workspaceId: string, next: WorkspaceAssumptions, userId: string, note = "Edited in Settings") {
  const parsed = assumptionsSchema.parse(next);
  const db = getDb();
  const now = nowIso();
  const previous = db.select().from(s.assumptions).where(eq(s.assumptions.workspaceId, workspaceId)).get();
  db.transaction((tx) => {
    if (previous) tx.insert(s.assumptionHistory).values({ id: newId("ah"), workspaceId, json: previous.json, provenance: "user_edited", note, effectiveFrom: previous.updatedAt, supersededAt: now, changedBy: userId }).run();
    tx.insert(s.assumptions)
      .values({ workspaceId, json: JSON.stringify(parsed), updatedAt: now, updatedBy: userId })
      .onConflictDoUpdate({ target: s.assumptions.workspaceId, set: { json: JSON.stringify(parsed), updatedAt: now, updatedBy: userId } })
      .run();
  });
  revalidatePath("/", "layout");
}

export async function updateCompanyAssumptions(_prev: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const viewer = await requireViewer();
    if (!canEditAssumptions(viewer)) throw new AuthorizationError("You need edit access to the company space to change these.");
    const a = structuredClone(viewer.assumptions);
    a.company.anticipatedRevenueCents = moneyOrNull(fd, "anticipatedRevenue");
    a.company.revenueBasis = str(fd, "revenueBasis") === "contracted" ? "contracted" : "anticipated";
    a.company.employerPayrollCostRatePct = pctOrNull(fd, "employerPayrollCostRatePct");
    a.company.otherOverheadCents = moneyOrNull(fd, "otherOverhead");
    a.company.cashReserveTargetMonths = intOrNull(fd, "cashReserveTargetMonths");
    if (fd.has("taxReserveRatePct")) {
      a.company.taxes.reserveRatePct = pctOrNull(fd, "taxReserveRatePct");
      a.company.taxes.reserveSource = str(fd, "taxReserveSource") || null;
      a.company.taxes.reserveYear = intOrNull(fd, "taxReserveYear");
      a.company.taxes.reviewStatus = str(fd, "taxReviewStatus") === "cpa_reviewed" ? "cpa_reviewed" : "unreviewed";
      a.company.taxes.caEntityRule.applicabilityReviewed = str(fd, "caRuleReviewed") === "1";
    }
    if (fd.has("entityVerified")) a.company.entity.verified = str(fd, "entityVerified") === "1";
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
    const incomeTax = fd.has("incomeTax") ? moneyOrNull(fd, "incomeTax") : current.withholding.incomeTaxCents;
    const sourceRaw = str(fd, "withholdingSource");
    const source = incomeTax === null ? "none" : sourceRaw === "paystub" || sourceRaw === "provider" ? sourceRaw : "estimate";
    a.owners[personId] = {
      ...current,
      grossSalaryCents: fd.has("grossSalary") ? moneyOrNull(fd, "grossSalary") : current.grossSalaryCents,
      withholding: {
        incomeTaxCents: incomeTax,
        incomeTaxLowCents: fd.has("incomeTaxLow") ? moneyOrNull(fd, "incomeTaxLow") : current.withholding.incomeTaxLowCents,
        incomeTaxHighCents: fd.has("incomeTaxHigh") ? moneyOrNull(fd, "incomeTaxHigh") : current.withholding.incomeTaxHighCents,
        source,
      },
      otherNetIncomeCents: fd.has("otherNetIncome") ? moneyOrNull(fd, "otherNetIncome") : current.otherNetIncomeCents,
      householdContributionCents: fd.has("householdContribution") ? moneyOrNull(fd, "householdContribution") : current.householdContributionCents,
    };
    if (fd.has("ficaEmployeePct") && viewer.workspaceRole === "owner") {
      a.payrollRules.ficaEmployeePct = pctOrNull(fd, "ficaEmployeePct");
      a.payrollRules.sdiPct = pctOrNull(fd, "sdiPct");
    }
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

