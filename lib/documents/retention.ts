/**
 * Document retention: a retain-until date is computed ONLY when the retention policy
 * parameter for that document kind is CONFIRMED. Unconfirmed defaults yield null
 * (the document is kept indefinitely; nothing is ever deleted on an unconfirmed basis).
 */
import type { DocumentKind, ISODate, Policy } from "@/lib/core/types";
import { addMonths } from "@/lib/core/dates";
import { POLICY_KEYS, policyByKey, type RetentionRule } from "@/lib/knowledge/policies";

export interface RetentionResult {
  policyKey: string;
  retainUntil: ISODate | null;
  basis: "CONFIRMED" | "UNCONFIRMED" | "NO_POLICY";
  permanent: boolean;
  years: number | null;
  note: string;
}

export function retentionRuleFor(kind: DocumentKind, policies: Policy[]): RetentionRule | undefined {
  const p = policyByKey(policies, POLICY_KEYS.DOCUMENT_RETENTION);
  const kinds = p?.parameters?.kinds as Record<string, RetentionRule> | undefined;
  return kinds?.[kind] ?? kinds?.OTHER;
}

export function retentionFor(kind: DocumentKind, policies: Policy[], fromDate?: ISODate): RetentionResult {
  const policyKey = POLICY_KEYS.DOCUMENT_RETENTION;
  const policy = policyByKey(policies, policyKey);
  const rule = retentionRuleFor(kind, policies);
  if (!policy || !rule) {
    return { policyKey, retainUntil: null, basis: "NO_POLICY", permanent: false, years: null, note: "No retention policy for this document kind; retained indefinitely." };
  }
  if (rule.status !== "CONFIRMED" || policy.status !== "ACTIVE") {
    return { policyKey, retainUntil: null, basis: "UNCONFIRMED", permanent: rule.permanent, years: rule.years, note: `Retention default (${rule.permanent ? "permanent" : `${rule.years} years`}) is UNCONFIRMED; retain-until not computed. ${rule.note ?? ""}`.trim() };
  }
  if (rule.permanent || rule.years === null) {
    return { policyKey, retainUntil: null, basis: "CONFIRMED", permanent: true, years: null, note: "Permanent retention." };
  }
  if (!fromDate) {
    return { policyKey, retainUntil: null, basis: "CONFIRMED", permanent: false, years: rule.years, note: "Confirmed retention but no document date supplied." };
  }
  return { policyKey, retainUntil: addMonths(fromDate, rule.years * 12), basis: "CONFIRMED", permanent: false, years: rule.years, note: `Retain ${rule.years} years from ${fromDate}.` };
}
