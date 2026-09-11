"use client";

import { useActionState, useState } from "react";
import { updateCompanyAssumptions, updateOwnerAssumptions } from "@/lib/actions/assumptions";
import type { ActionResult } from "@/lib/actions/helpers";
import { ALLOCATION_KIND_OPTIONS, type Allocation, type OwnerAssumptions, type WorkspaceAssumptions } from "@/lib/assumptions";

function dollars(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

export function Field({ label, name, defaultValue, hint, inputMode = "decimal", placeholder = "Unknown", required }: { label: string; name: string; defaultValue: string | number; hint?: string; inputMode?: "decimal" | "numeric" | "text"; placeholder?: string; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <input name={name} className="input mt-1" inputMode={inputMode} defaultValue={defaultValue} placeholder={placeholder} required={required} />
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Status({ state }: { state: ActionResult | undefined }) {
  if (!state) return null;
  return state.ok ? <p className="text-sm text-good">Saved.</p> : <p className="text-sm text-bad">{state.error}</p>;
}

let counter = 0;

export function CompanyAssumptionsForm({ a, completeOnboarding, submitLabel = "Save company assumptions" }: { a: WorkspaceAssumptions; completeOnboarding?: boolean; submitLabel?: string }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateCompanyAssumptions, undefined);
  const [allocations, setAllocations] = useState<Allocation[]>(a.company.allocations);
  const c = a.company;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" data-testid="company-assumptions-form">
      {completeOnboarding && <input type="hidden" name="completeOnboarding" value="1" />}
      <input type="hidden" name="allocationsPresent" value="1" />
      <Field label="Monthly service revenue" name="anticipatedRevenue" defaultValue={dollars(c.anticipatedRevenueCents)} hint="Company revenue. Never personal take-home." />
      <label className="block text-sm">
        <span className="label">Revenue basis</span>
        <select name="revenueBasis" className="input mt-1" defaultValue={c.revenueBasis}>
          <option value="anticipated">Anticipated (not yet contracted)</option>
          <option value="contracted">Contracted</option>
        </select>
      </label>

      <fieldset className="sm:col-span-2">
        <legend className="label">Monthly allocations</legend>
        <p className="mt-1 text-xs text-ink-3">Money set aside each month beyond salaries and bills. The kind decides whether it is a business expense, wages, or really an owner distribution to the household.</p>
        <div className="mt-2 space-y-2">
          {allocations.map((al, i) => (
            <div key={al.id} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1.2fr_0.7fr_1.4fr_auto]" data-testid="allocation-row">
              <input type="hidden" name={`alloc.${i}.id`} value={al.id} />
              <label className="text-sm">
                <span className="label">Name</span>
                <input name={`alloc.${i}.name`} className="input mt-1" defaultValue={al.name} required />
              </label>
              <label className="text-sm">
                <span className="label">Amount / month</span>
                <input name={`alloc.${i}.amount`} className="input mt-1" inputMode="decimal" defaultValue={dollars(al.amountCents)} placeholder="Unknown" />
              </label>
              <label className="text-sm">
                <span className="label">Kind</span>
                <select name={`alloc.${i}.kind`} className="input mt-1" defaultValue={al.kind}>
                  {ALLOCATION_KIND_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-end">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllocations((rows) => rows.filter((r) => r.id !== al.id))} aria-label={`Remove ${al.name}`}>Remove</button>
              </div>
              <label className="text-sm sm:col-span-4">
                <span className="label">Note</span>
                <input name={`alloc.${i}.note`} className="input mt-1" defaultValue={al.note ?? ""} placeholder="What this covers" />
              </label>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setAllocations((rows) => [...rows, { id: `new-${Date.now()}-${counter++}`, name: "", amountCents: null, kind: "business" }])}>
          Add allocation
        </button>
      </fieldset>

      <Field label="Employer payroll cost rate (% of W-2 wages)" name="employerPayrollCostRatePct" defaultValue={c.employerPayrollCostRatePct ?? ""} hint="Employer FICA, unemployment and similar. Blank = unknown." />
      <Field label="Business income tax reserve rate (% of profit)" name="incomeTaxReserveRatePct" defaultValue={c.incomeTaxReserveRatePct ?? ""} hint="Blank = unknown. Never assumed to be zero." />
      <Field label="Other monthly overhead not in bills" name="otherOverhead" defaultValue={dollars(c.otherOverheadCents)} hint="Blank = unknown. Enter 0 only if you are sure." />
      <Field label="Cash reserve target (months of operating cost)" name="cashReserveTargetMonths" defaultValue={c.cashReserveTargetMonths ?? ""} inputMode="numeric" placeholder="Not set" />
      <Field label="Planned monthly distribution to the household" name="plannedCompanyDistribution" defaultValue={dollars(a.household.plannedCompanyDistributionCents)} hint="What the company intends to pay out each month to fund rent, cars and shared bills. Blank = not decided." placeholder="Not decided" />
      <label className="block text-sm sm:col-span-2">
        <span className="label">Notes</span>
        <textarea name="notes" className="input mt-1 min-h-24" defaultValue={a.notes} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function OwnerAssumptionsForm({ personId, name, title, o, editable, showTitle = true }: { personId: string; name: string; title: string | null; o: OwnerAssumptions; editable: boolean; showTitle?: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateOwnerAssumptions, undefined);
  const w = o.withholding;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" data-testid={`owner-form-${personId}`}>
      <input type="hidden" name="personId" value={personId} />
      {showTitle && <Field label="Role" name="title" defaultValue={title ?? ""} inputMode="text" placeholder="e.g. CEO" />}
      <Field label={`${name}'s gross monthly salary`} name="grossSalary" defaultValue={dollars(o.grossSalaryCents)} hint="Gross W-2 pay. Net take-home is derived, never assumed." />
      <Field label="Employee FICA rate (% of gross)" name="ficaRatePct" defaultValue={w.ficaRatePct ?? ""} hint="Social Security 6.2% + Medicare 1.45% = 7.65%." />
      <Field label="Income tax withheld per month (estimate)" name="incomeTax" defaultValue={dollars(w.incomeTaxCents)} hint="Federal + California. Payroll or a CPA sets the exact figure." />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Estimate low" name="incomeTaxLow" defaultValue={dollars(w.incomeTaxLowCents)} placeholder="—" />
        <Field label="Estimate high" name="incomeTaxHigh" defaultValue={dollars(w.incomeTaxHighCents)} placeholder="—" />
      </div>
      <Field label="Other net income per month" name="otherNetIncome" defaultValue={dollars(o.otherNetIncomeCents)} placeholder="0" />
      <Field label="Household contribution per month" name="householdContribution" defaultValue={dollars(o.householdContributionCents)} hint="Sent to the joint account from personal pay. 0 when the company funds the household directly." placeholder="Unknown" />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending || !editable}>{pending ? "Saving…" : `Save ${name}'s details`}</button>
        {!editable && <span className="text-xs text-ink-3">Only {name} or a workspace owner can change these.</span>}
        <Status state={state} />
      </div>
    </form>
  );
}
