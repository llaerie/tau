/**
 * Tax calendar builder. Obligations exist as structural CATEGORIES (we know an S corporation
 * files an information return, CA has an S-corp return, employers file quarterly payroll
 * returns, ...). Their DUE DATES come only from usable TaxRules; when a rule is not usable the
 * obligation has dueDate null, status UNKNOWN and a pending note.
 *
 * Rule parameter conventions (set only by approved rules, never here):
 *   annual:    { dueMonth: 1-12, dueDay: 1-31, yearOffset?: 0|1 }        -> due in taxYear + yearOffset (default 1)
 *   quarterly: { q1Due: "MM-DD", q2Due, q3Due, q4Due, q4YearOffset?: 1 } -> Q4 due in taxYear + q4YearOffset (default 1)
 *   window:    { dueMonth, dueDay, yearOffset } same as annual (Statement of Information)
 */
import type { CompanyDataset, ISODate, TaxObligation } from "@/lib/core/types";
import { pad2 } from "@/lib/core/dates";
import type { RuleResolution, TaxRuleStore } from "./rule-store";

export const PENDING_DUE_DATE_NOTE = "due date pending authoritative source retrieval + CPA confirmation";

interface ObligationSpec {
  kind: string;
  jurisdiction: TaxObligation["jurisdiction"];
  title: string;
  description: string;
  ruleKey: string;
  cadence: "ANNUAL" | "QUARTERLY";
  notes?: string[];
}

const SPECS: ObligationSpec[] = [
  { kind: "FORM_1120S", jurisdiction: "FEDERAL", title: "Federal S corporation information return (Form 1120-S)", description: "Annual federal information return for the S corporation, with Schedule K-1 to the shareholder.", ruleKey: "fed_s_corp_return_due", cadence: "ANNUAL" },
  { kind: "CA_FORM_100S", jurisdiction: "CALIFORNIA", title: "California S corporation return and franchise tax (Form 100S)", description: "Annual California S corporation return; franchise tax amount depends on rules that are not yet usable.", ruleKey: "ca_100s_due", cadence: "ANNUAL" },
  { kind: "FORM_941", jurisdiction: "FEDERAL", title: "Federal quarterly payroll return (Form 941)", description: "Quarterly federal employment tax return reporting wages, withholding and FICA.", ruleKey: "fed_941_quarterly_due", cadence: "QUARTERLY" },
  { kind: "CA_DE9", jurisdiction: "CALIFORNIA", title: "California quarterly payroll return (DE 9 / DE 9C)", description: "Quarterly California contribution return and wage report.", ruleKey: "ca_de9_quarterly_due", cadence: "QUARTERLY" },
  { kind: "FORM_940", jurisdiction: "FEDERAL", title: "Annual federal unemployment return (Form 940)", description: "Annual FUTA return.", ruleKey: "fed_940_annual_due", cadence: "ANNUAL" },
  { kind: "1099_NEC", jurisdiction: "FEDERAL", title: "Information returns for contractors (Form 1099-NEC)", description: "Furnish and file information returns for reportable contractor payments; which payees are reportable is confirmed with the CPA.", ruleKey: "fed_1099_nec_due", cadence: "ANNUAL" },
  { kind: "CA_STATEMENT_OF_INFORMATION", jurisdiction: "CALIFORNIA", title: "California Statement of Information (Secretary of State)", description: "Periodic LLC Statement of Information filing; cadence depends on formation date and SOS rules.", ruleKey: "ca_statement_of_information_due", cadence: "ANNUAL" },
];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function annualDue(res: RuleResolution, taxYear: number): ISODate | null {
  if (!res.usable || !res.rule?.parameters) return null;
  const p = res.rule.parameters;
  const m = num(p.dueMonth);
  const d = num(p.dueDay);
  if (m === null || d === null) return null;
  const offset = num(p.yearOffset) ?? 1;
  return `${taxYear + offset}-${pad2(m)}-${pad2(d)}`;
}

function quarterlyDue(res: RuleResolution, taxYear: number, q: 1 | 2 | 3 | 4): ISODate | null {
  if (!res.usable || !res.rule?.parameters) return null;
  const raw = res.rule.parameters[`q${q}Due`];
  if (typeof raw !== "string" || !/^\d{2}-\d{2}$/.test(raw)) return null;
  const year = q === 4 ? taxYear + (num(res.rule.parameters.q4YearOffset) ?? 1) : taxYear;
  return `${year}-${raw}`;
}

function statusFor(dueDate: ISODate | null, asOf: ISODate): TaxObligation["status"] {
  if (!dueDate) return "UNKNOWN";
  return dueDate < asOf ? "DUE" : "UPCOMING";
}

function obligation(spec: ObligationSpec, taxYear: number, res: RuleResolution, dueDate: ISODate | null, asOf: ISODate, periodLabel?: string): TaxObligation {
  const notes = [...(spec.notes ?? [])];
  if (!dueDate) notes.push(PENDING_DUE_DATE_NOTE, res.reason);
  return {
    id: `oblig_${spec.kind.toLowerCase()}_${taxYear}${periodLabel ? `_${periodLabel.toLowerCase()}` : ""}`,
    jurisdiction: spec.jurisdiction,
    kind: spec.kind,
    title: spec.title,
    description: spec.description,
    taxYear,
    periodLabel,
    dueDate,
    amount: null,
    currency: "USD",
    status: statusFor(dueDate, asOf),
    ruleSourceId: res.rule?.id,
    requiresCpaReview: true,
    documentIds: [],
    notes,
  };
}

/** Owner's personal estimated taxes: OUT OF SCOPE for the business system; reminder only. */
export function ownerPersonalEstimatedTaxReminder(taxYear: number): TaxObligation {
  return {
    id: `oblig_owner_personal_estimated_tax_reminder_${taxYear}`,
    jurisdiction: "FEDERAL",
    kind: "OWNER_PERSONAL_ESTIMATED_TAX_REMINDER",
    title: "Reminder: owner's personal estimated taxes (federal and California)",
    description: "S corporation income flows through to the owner's personal return. Personal estimated payments are handled in the owner's personal/household system, NOT here. This item exists only as a reminder and never carries an amount or due date.",
    taxYear,
    dueDate: null,
    amount: null,
    currency: "USD",
    status: "NOT_APPLICABLE_PENDING_REVIEW",
    requiresCpaReview: true,
    documentIds: [],
    notes: ["PERSONAL — out of scope for the business system", "flagged: personal", PENDING_DUE_DATE_NOTE],
  };
}

export function buildTaxCalendar(dataset: CompanyDataset, taxYear: number, ruleStore: TaxRuleStore, asOf: ISODate): TaxObligation[] {
  const out: TaxObligation[] = [];
  const hasWorkers = dataset.workers.length > 0;
  const hasContractors = dataset.workers.some((w) => w.workerType === "CONTRACTOR" || w.workerType === "UNRESOLVED") || dataset.vendors.some((v) => v.taxDocStatus !== "NOT_REQUIRED");

  for (const spec of SPECS) {
    const res = ruleStore.resolveRule(spec.ruleKey, taxYear, asOf);
    const extra: string[] = [];
    if ((spec.kind === "FORM_941" || spec.kind === "CA_DE9" || spec.kind === "FORM_940") && !hasWorkers) extra.push("No workers in dataset; confirm with CPA whether payroll returns apply.");
    if (spec.kind === "1099_NEC" && !hasContractors) extra.push("No contractor payees identified; confirm with CPA whether any information returns are required.");
    const withNotes = { ...spec, notes: [...(spec.notes ?? []), ...extra] };
    if (spec.cadence === "QUARTERLY") {
      for (const q of [1, 2, 3, 4] as const) {
        out.push(obligation(withNotes, taxYear, res, quarterlyDue(res, taxYear, q), asOf, `Q${q}`));
      }
    } else {
      out.push(obligation(withNotes, taxYear, res, annualDue(res, taxYear), asOf));
    }
  }
  out.push(ownerPersonalEstimatedTaxReminder(taxYear));
  return out;
}

export function calendarSummary(obligations: TaxObligation[]): { total: number; unknownDueDates: number; upcoming: number; due: number; personalReminders: number } {
  return {
    total: obligations.length,
    unknownDueDates: obligations.filter((o) => o.dueDate === null).length,
    upcoming: obligations.filter((o) => o.status === "UPCOMING").length,
    due: obligations.filter((o) => o.status === "DUE").length,
    personalReminders: obligations.filter((o) => o.kind === "OWNER_PERSONAL_ESTIMATED_TAX_REMINDER").length,
  };
}
