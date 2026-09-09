/**
 * Role-aware redaction of entities before they are shown or sent to a model.
 *
 * - Roles without VIEW_PAYROLL_DETAIL lose per-worker payroll amounts (PayrollLine
 *   fields, Worker.compensation.amount); totals remain.
 * - Roles without VIEW_SENSITIVE_IDENTIFIERS get last4 / EIN / SSN / account-number
 *   style fields masked, and EIN/SSN-shaped values masked wherever they appear.
 * The input is never mutated; a deep copy is returned.
 */
import type { Role } from "@/lib/core/types";
import { can } from "./rbac";

export const REDACTED = "[REDACTED]";

/** Per-worker payroll amount fields (PayrollLine) that are hidden without VIEW_PAYROLL_DETAIL. */
export const PAYROLL_LINE_AMOUNT_KEYS: readonly string[] = Object.freeze([
  "gross",
  "federalIncomeTaxWithheld",
  "stateIncomeTaxWithheld",
  "socialSecurityEmployee",
  "medicareEmployee",
  "stateDisabilityEmployee",
  "otherDeductions",
  "netPay",
  "socialSecurityEmployer",
  "medicareEmployer",
  "federalUnemploymentEmployer",
  "stateUnemploymentEmployer",
  "stateTrainingTaxEmployer",
  "otherEmployerCosts",
  "totalEmployerCost",
]);

const IDENTIFIER_KEY_RE = /(^|_|\b)(last4|last_4|ein|ssn|taxid|tax_id|itin|routingnumber|routing_number|accountnumber|account_number|iban|swift)($|_|\b)/i;
const EIN_VALUE_RE = /\b\d{2}-\d{7}\b/g;
const SSN_VALUE_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

function isPayrollLine(o: Record<string, unknown>): boolean {
  return typeof o.workerId === "string" && "gross" in o && "netPay" in o;
}

function isCompensation(o: Record<string, unknown>): boolean {
  return "basis" in o && "amount" in o && "period" in o && "type" in o;
}

export function maskIdentifier(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (value.length <= 4) return "••••";
  return `${"•".repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

export function maskIdentifierPatterns(text: string): string {
  return text.replace(EIN_VALUE_RE, "••-•••••••").replace(SSN_VALUE_RE, "•••-••-••••");
}

export interface RedactionOptions {
  hidePayrollDetail: boolean;
  maskIdentifiers: boolean;
}

export function redactionOptionsFor(role: Role): RedactionOptions {
  return { hidePayrollDetail: !can(role, "VIEW_PAYROLL_DETAIL"), maskIdentifiers: !can(role, "VIEW_SENSITIVE_IDENTIFIERS") };
}

function walk(value: unknown, opts: RedactionOptions, parentIsPayrollLine = false): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, opts));
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const payrollLine = opts.hidePayrollDetail && isPayrollLine(src);
    const compensation = opts.hidePayrollDetail && isCompensation(src);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (payrollLine && PAYROLL_LINE_AMOUNT_KEYS.includes(k)) out[k] = REDACTED;
      else if (compensation && k === "amount") out[k] = REDACTED;
      else if (opts.maskIdentifiers && IDENTIFIER_KEY_RE.test(k)) out[k] = maskIdentifier(v);
      else out[k] = walk(v, opts, payrollLine);
    }
    if (payrollLine) out.redacted = true;
    return out;
  }
  if (typeof value === "string" && opts.maskIdentifiers && !parentIsPayrollLine) return maskIdentifierPatterns(value);
  return value;
}

/** Returns a redacted deep copy of `entity` appropriate for `role`. */
export function redactForRole<T>(entity: T, role: Role): T {
  const opts = redactionOptionsFor(role);
  if (!opts.hidePayrollDetail && !opts.maskIdentifiers) return structuredClone(entity);
  return walk(entity, opts) as T;
}

/** Redact for the AGENT role — what a model is allowed to see. */
export function redactForModel<T>(entity: T): T {
  return redactForRole(entity, "AGENT");
}
