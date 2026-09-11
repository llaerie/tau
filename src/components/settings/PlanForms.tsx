"use client";

import { useActionState } from "react";
import { updateCompanyAssumptions, updateOwnerAssumptions } from "@/lib/actions/assumptions";
import type { ActionResult } from "@/lib/actions/helpers";
import type { OwnerAssumptions, WorkspaceAssumptions } from "@/lib/assumptions";
import { ActionFlowCard, useDraftAction } from "@/components/money/ActionFlow";

function dollars(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function Field({ label, name, defaultValue, hint, inputMode = "decimal", placeholder = "Unknown" }: { label: string; name: string; defaultValue: string | number; hint?: string; inputMode?: "decimal" | "numeric" | "text"; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="label">{label}</span>
      <input name={name} className="input mt-1" inputMode={inputMode} defaultValue={defaultValue} placeholder={placeholder} data-testid={`field-${name}`} />
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

function Status({ state }: { state: ActionResult | undefined }) {
  if (!state) return null;
  return state.ok ? <p className="text-sm text-good">Saved. The previous values are kept in the assumption history.</p> : <p className="text-sm text-bad">{state.error}</p>;
}

export function PayrollForm({ personId, name, o, editable, rules, isOwner }: { personId: string; name: string; o: OwnerAssumptions; editable: boolean; rules: WorkspaceAssumptions["payrollRules"]; isOwner: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateOwnerAssumptions, undefined);
  const w = o.withholding;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" data-testid={`payroll-form-${personId}`}>
      <input type="hidden" name="personId" value={personId} />
      <Field label={`${name}'s gross monthly salary`} name="grossSalary" defaultValue={dollars(o.grossSalaryCents)} hint="Gross W-2 pay. Take-home is derived, never assumed." />
      <label className="block text-sm">
        <span className="label">Withholding source</span>
        <select name="withholdingSource" className="input mt-1" defaultValue={w.source === "none" ? "estimate" : w.source} data-testid="withholding-source">
          <option value="estimate">Estimate (not verified)</option>
          <option value="paystub">From a pay stub</option>
          <option value="provider">From the payroll provider</option>
        </select>
        <span className="mt-1 block text-[12px] text-ink-3">Only pay-stub or provider figures make take-home “verified”.</span>
      </label>
      <Field label="Federal + state income tax withheld per month" name="incomeTax" defaultValue={dollars(w.incomeTaxCents)} hint="Blank = unknown. Take-home stays incomplete until this is entered." />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Estimate low" name="incomeTaxLow" defaultValue={dollars(w.incomeTaxLowCents)} placeholder="—" />
        <Field label="Estimate high" name="incomeTaxHigh" defaultValue={dollars(w.incomeTaxHighCents)} placeholder="—" />
      </div>
      <Field label="Other net income per month" name="otherNetIncome" defaultValue={dollars(o.otherNetIncomeCents)} placeholder="0" />
      <Field label="Household contribution from personal pay" name="householdContribution" defaultValue={dollars(o.householdContributionCents)} hint="0 while the company pays the household bills directly." placeholder="Unknown" />
      {isOwner && (
        <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
          <legend className="label mb-1">Statutory employee withholding ({rules.effectiveYear})</legend>
          <Field label="Employee FICA (% of gross)" name="ficaEmployeePct" defaultValue={rules.ficaEmployeePct ?? ""} hint="Social Security 6.2% + Medicare 1.45% = 7.65%." />
          <Field label="California SDI (% of gross)" name="sdiPct" defaultValue={rules.sdiPct ?? ""} hint={rules.source} />
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending || !editable} data-testid={`payroll-save-${personId}`}>{pending ? "Saving…" : `Save ${name}'s payroll details`}</button>
        {!editable && <span className="text-xs text-ink-3">Only {name} can change these.</span>}
        <Status state={state} />
      </div>
    </form>
  );
}

export function CompanyForm({ a }: { a: WorkspaceAssumptions }) {
  const [state, action, pending] = useActionState<ActionResult | undefined, FormData>(updateCompanyAssumptions, undefined);
  const c = a.company;
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" data-testid="company-form">
      <Field label="Anticipated monthly receipts" name="anticipatedRevenue" defaultValue={dollars(c.anticipatedRevenueCents)} hint="Company revenue for services. Never personal take-home." />
      <label className="block text-sm">
        <span className="label">Basis</span>
        <select name="revenueBasis" className="input mt-1" defaultValue={c.revenueBasis}>
          <option value="anticipated">Anticipated (not yet contracted)</option>
          <option value="contracted">Contracted</option>
        </select>
        <span className="mt-1 block text-[12px] text-ink-3">Payer: {c.payer.relationship.replace("_", " ")}. {c.payer.description}</span>
      </label>
      <Field label="Employer payroll cost rate (% of wages)" name="employerPayrollCostRatePct" defaultValue={c.employerPayrollCostRatePct ?? ""} hint="Employer FICA, unemployment and similar. Blank = unknown, never zero." />
      <Field label="Other monthly overhead (insurance, hosting, CPA)" name="otherOverhead" defaultValue={dollars(c.otherOverheadCents)} hint="Blank = unknown. Enter 0 only if you are sure." />
      <Field label="Cash reserve target (months)" name="cashReserveTargetMonths" defaultValue={c.cashReserveTargetMonths ?? ""} inputMode="numeric" placeholder="Not set" />
      <Field label="Planned monthly owner distribution to the household" name="plannedCompanyDistribution" defaultValue={dollars(a.household.plannedCompanyDistributionCents)} hint="What the company intends to pay out, beyond the bills it pays directly. Blank = not decided." placeholder="Not decided" />

      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-2" id="tax">
        <legend className="label mb-1">Taxes</legend>
        <p className="text-[12.5px] text-ink-2 sm:col-span-2">{c.taxes.note}</p>
        <Field label="Income-tax reserve rate (% of profit)" name="taxReserveRatePct" defaultValue={c.taxes.reserveRatePct ?? ""} hint="Blank = unknown. Set only from a CPA or your own reviewed figure." />
        <Field label="Reserve source" name="taxReserveSource" defaultValue={c.taxes.reserveSource ?? ""} inputMode="text" placeholder="e.g. CPA letter, 2026-08" />
        <Field label="Tax year" name="taxReserveYear" defaultValue={c.taxes.reserveYear ?? ""} inputMode="numeric" placeholder="2026" />
        <label className="block text-sm">
          <span className="label">Review status</span>
          <select name="taxReviewStatus" className="input mt-1" defaultValue={c.taxes.reviewStatus}>
            <option value="unreviewed">Unreviewed</option>
            <option value="cpa_reviewed">Reviewed by a CPA</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="caRuleReviewed" value="1" defaultChecked={c.taxes.caEntityRule.applicabilityReviewed} /> California 1.5% / $800 minimum S-corp rule applicability reviewed</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="entityVerified" value="1" defaultChecked={c.entity.verified} /> S-corporation election documentation verified</label>
      </fieldset>

      <label className="block text-sm sm:col-span-2">
        <span className="label">Notes</span>
        <textarea name="notes" className="input mt-1 min-h-20" defaultValue={a.notes} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary" disabled={pending} data-testid="company-save">{pending ? "Saving…" : "Save company assumptions"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ArchiveRecordButton({ entity, id, label }: { entity: "goal" | "budget" | "subscription" | "purchase_plan"; id: string; label: string }) {
  const flow = useDraftAction(`archive-${id}`);
  return (
    <div>
      {!flow.action && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={flow.busy} onClick={() => flow.draft("archive_record", { entity, id })} data-testid={`archive-${id}`}>
          Archive {label}
        </button>
      )}
      {flow.error && <p className="text-[13px] text-bad">{flow.error}</p>}
      {flow.action && <ActionFlowCard action={flow.action} onChange={flow.onChange} onDone={flow.clear} />}
    </div>
  );
}
