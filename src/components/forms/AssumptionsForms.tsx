"use client";

import { useActionState } from "react";
import { updateCompanyAssumptions, updateOwnerAssumptions } from "@/lib/actions/assumptions";
import type { ActionResult } from "@/lib/actions/helpers";
import { EMPLOYEE_CLASSIFICATION_OPTIONS, type OwnerAssumptions, type WorkspaceAssumptions } from "@/lib/assumptions";

function dollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function Field({ label, name, defaultValue, hint, inputMode = "decimal", placeholder = "Unknown" }: { label: string; name: string; defaultValue: string | number; hint?: string; inputMode?: "decimal" | "numeric"; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <input name={name} className="input mt-1" inputMode={inputMode} defaultValue={defaultValue} placeholder={placeholder} />
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Status({ state }: { state: ActionResult | undefined }) {
  if (!state) return null;
  return state.ok ? <p className="text-sm text-good">Saved.</p> : <p className="text-sm text-bad">{state.error}</p>;
}

export function CompanyAssumptionsForm({ a, completeOnboarding, submitLabel = "Save company assumptions" }: { a: WorkspaceAssumptions; completeOnboarding?: boolean; submitLabel?: string }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateCompanyAssumptions, undefined);
  const c = a.company;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" data-testid="company-assumptions-form">
      {completeOnboarding && <input type="hidden" name="completeOnboarding" value="1" />}
      <Field label="Monthly service revenue" name="anticipatedRevenue" defaultValue={dollars(c.anticipatedRevenueCents)} hint="Company revenue. Never personal take-home." />
      <label className="block text-sm"><span className="label">Revenue basis</span>
        <select name="revenueBasis" className="input mt-1" defaultValue={c.revenueBasis}>
          <option value="anticipated">Anticipated (not yet contracted)</option>
          <option value="contracted">Contracted</option>
        </select>
      </label>
      <Field label="Employee allocation per month" name="employeeAllocation" defaultValue={dollars(c.employeeAllocationCents)} hint="The stated amount set aside for employees." />
      <label className="block text-sm"><span className="label">Employee allocation classification</span>
        <select name="employeeClassification" className="input mt-1" defaultValue={c.employeeClassification} data-testid="employee-classification">
          {EMPLOYEE_CLASSIFICATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="mt-1 block text-xs text-ink-3">Leave unresolved until decided; payroll costs on it stay unknown.</span>
      </label>
      <Field label="Employer payroll cost rate (% of W-2 wages)" name="employerPayrollCostRatePct" defaultValue={c.employerPayrollCostRatePct ?? ""} hint="FICA, unemployment and similar. Blank = unknown." />
      <Field label="Business income tax reserve rate (% of profit)" name="incomeTaxReserveRatePct" defaultValue={c.incomeTaxReserveRatePct ?? ""} hint="Blank = unknown. Never assumed to be zero." />
      <Field label="Other monthly overhead not in bills" name="otherOverhead" defaultValue={dollars(c.otherOverheadCents)} hint="Blank = unknown. Enter 0 only if you are sure." />
      <Field label="Cash reserve target (months of operating cost)" name="cashReserveTargetMonths" defaultValue={c.cashReserveTargetMonths ?? ""} inputMode="numeric" placeholder="Not set" />
      <Field label="Planned monthly distribution to the household" name="plannedCompanyDistribution" defaultValue={dollars(a.household.plannedCompanyDistributionCents)} hint="What you intend to pay out, not what is available. Blank = unknown." placeholder="Unknown" />
      <label className="block text-sm sm:col-span-2"><span className="label">Notes</span><textarea name="notes" className="input mt-1 min-h-24" defaultValue={a.notes} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function OwnerAssumptionsForm({ personId, name, o, editable }: { personId: string; name: string; o: OwnerAssumptions; editable: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateOwnerAssumptions, undefined);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" data-testid={`owner-form-${personId}`}>
      <input type="hidden" name="personId" value={personId} />
      <Field label={`${name}'s gross monthly salary`} name="grossSalary" defaultValue={dollars(o.grossSalaryCents)} hint="Gross. Net take-home is derived, never assumed." />
      <Field label="Withholding estimate (% of gross)" name="withholdingRatePct" defaultValue={o.withholdingRatePct ?? ""} hint="Income tax plus employee FICA. Blank = unknown." />
      <Field label="Other net income per month" name="otherNetIncome" defaultValue={dollars(o.otherNetIncomeCents)} placeholder="0" />
      <Field label="Household contribution per month" name="householdContribution" defaultValue={dollars(o.householdContributionCents)} hint="Sent to the joint account each month. Blank = unknown." />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending || !editable}>{pending ? "Saving…" : `Save ${name}'s assumptions`}</button>
        {!editable && <span className="text-xs text-ink-3">Only {name} or a workspace owner can change these.</span>}
        <Status state={state} />
      </div>
    </form>
  );
}
