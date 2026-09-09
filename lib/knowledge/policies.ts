/**
 * Default company policies.
 *
 * Policies that the product specification mandates as system CONTROLS are ACTIVE with
 * approvedBy "SYSTEM_PHASE_ONE". Everything that depends on a company decision or a
 * professional's confirmation is DRAFT, and its numeric parameters are UNCONFIRMED
 * defaults — never asserted as law or as the company's actual rule.
 */
import type { FieldStatus, Policy } from "@/lib/core/types";

export const SYSTEM_APPROVER = "SYSTEM_PHASE_ONE";
const EFFECTIVE = "2026-01-01";

/** A policy parameter with an explicit status. Unknown -> value null. */
export interface PolicyParameter<T = unknown> {
  value: T | null;
  status: FieldStatus;
  note?: string;
}

export const POLICY_KEYS = {
  PERSONAL_BUSINESS_SEPARATION: "personal_business_separation",
  EXPENSE_DOCUMENTATION: "expense_documentation",
  MEALS: "meals",
  APPROVAL_MATRIX: "approval_matrix",
  DOCUMENT_RETENTION: "document_retention",
  CASH_RESERVE: "cash_reserve",
  PERIOD_LOCK: "period_lock",
  RELATED_PARTY: "related_party_transactions",
  INTERNATIONAL_WORKER: "international_worker",
  AI_AUTONOMY: "ai_autonomy",
  DATA_SEPARATION: "data_separation",
} as const;
export type PolicyKey = (typeof POLICY_KEYS)[keyof typeof POLICY_KEYS];

/** Retention parameter shape used by lib/documents/retention.ts. */
export interface RetentionRule {
  years: number | null;
  permanent: boolean;
  status: FieldStatus;
  note?: string;
}

const unconfirmedYears = (years: number, note?: string): RetentionRule => ({ years, permanent: false, status: "UNCONFIRMED", note: note ?? "Default to be confirmed by CPA; not asserted as law." });

export const DEFAULT_RETENTION_RULES: Record<string, RetentionRule> = {
  TAX_RETURN: { years: null, permanent: true, status: "UNCONFIRMED", note: "Default: permanent. Confirm with CPA." },
  ENTITY_DOCUMENT: { years: null, permanent: true, status: "UNCONFIRMED", note: "Default: permanent. Confirm with CPA/attorney." },
  BANK_STATEMENT: unconfirmedYears(7),
  CARD_STATEMENT: unconfirmedYears(7),
  RECEIPT: unconfirmedYears(7),
  CUSTOMER_INVOICE: unconfirmedYears(7),
  VENDOR_BILL: unconfirmedYears(7),
  CONTRACT: unconfirmedYears(7, "Default: 7 years after expiry. Confirm with attorney."),
  PAYROLL_REPORT: unconfirmedYears(4, "Default: at least 4 years. Confirm with CPA / payroll professional."),
  W9: unconfirmedYears(4),
  W8: unconfirmedYears(4),
  TAX_NOTICE: unconfirmedYears(7),
  INSURANCE: unconfirmedYears(7),
  CPA_CORRESPONDENCE: unconfirmedYears(7),
  OTHER: unconfirmedYears(7),
};

function control(key: PolicyKey, title: string, body: string, parameters?: Record<string, unknown>): Policy {
  return { id: `pol_${key}_v1`, key, title, body, version: 1, status: "ACTIVE", effectiveDate: EFFECTIVE, approvedBy: SYSTEM_APPROVER, parameters };
}
function draft(key: PolicyKey, title: string, body: string, parameters?: Record<string, unknown>): Policy {
  return { id: `pol_${key}_v1`, key, title, body, version: 1, status: "DRAFT", effectiveDate: EFFECTIVE, parameters };
}

export function defaultPolicies(): Policy[] {
  return [
    control(
      POLICY_KEYS.PERSONAL_BUSINESS_SEPARATION,
      "Personal / business separation policy",
      "Business accounts are used only for business transactions. Any transaction that appears personal is flagged POSSIBLE_PERSONAL, posted to the review holding account, and never treated as a deductible business expense until the owner confirms its business purpose and, where required, the CPA reviews it. Personal expenses paid from business funds are recorded as shareholder distributions or receivables only with owner approval.",
      { flagOnDetection: true, holdingAccountCode: "7990", autoDeductPersonal: false },
    ),
    draft(
      POLICY_KEYS.EXPENSE_DOCUMENTATION,
      "Expense documentation policy",
      "Every business expense should have supporting documentation. A receipt or invoice is required for any single expense at or above the receipt threshold. Expenses without documentation are flagged MISSING_RECEIPT and reported in the weekly brief until resolved.",
      { receiptThreshold: { value: "75.00", status: "UNCONFIRMED", note: "Default; owner to confirm." } satisfies PolicyParameter<string>, currency: "USD" },
    ),
    draft(
      POLICY_KEYS.MEALS,
      "Meals policy",
      "A meal is recorded as a business meal only when the business purpose and the attendees (names and relationship) are documented, together with an itemized receipt. The system never treats a meal as automatically deductible; the deductible portion for any tax year is a tax-rule lookup requiring a retrieved authoritative source and CPA confirmation.",
      { requireBusinessPurpose: true, requireAttendees: true, autoDeductible: false },
    ),
    control(
      POLICY_KEYS.APPROVAL_MATRIX,
      "Approval matrix policy",
      "Actions are classified GREEN, YELLOW or RED. GREEN actions (calculations, reports, reconciliations, routine categorization within approved patterns) may auto-execute at the agent's certified capability level. YELLOW actions (new categories, new vendors, journal entries, forecast changes, non-standard invoices) require owner or finance-operator approval. RED actions (any money movement, payroll changes, compensation policy, tax filings or payments, entity changes, international worker classification, deletions, changes to closed periods, distributions) require owner approval plus professional approval where applicable, and are blocked from execution in Phase One regardless of approval.",
      { levels: ["GREEN", "YELLOW", "RED"], redAlwaysBlockedInPhaseOne: true, thresholds: { value: null, status: "UNCONFIRMED", note: "Dollar thresholds are a company decision; see materiality thresholds." } satisfies PolicyParameter },
    ),
    draft(
      POLICY_KEYS.DOCUMENT_RETENTION,
      "Document retention policy",
      "Documents are retained for at least the period set per document kind. The periods below are DEFAULTS marked UNCONFIRMED; they are placeholders to be confirmed by the CPA and are not statements of law. A document whose retention is unconfirmed has no computed retain-until date and is never deleted.",
      { kinds: DEFAULT_RETENTION_RULES, deleteWhenExpired: false },
    ),
    draft(
      POLICY_KEYS.CASH_RESERVE,
      "Cash reserve policy",
      "The company maintains a minimum operating cash reserve. The amount (or months of operating expenses) has not been set. Until confirmed, cash-runway reporting states the reserve as UNKNOWN rather than assuming any figure.",
      { minimumReserve: { value: null, status: "UNCONFIRMED", note: "Owner decision." } satisfies PolicyParameter<string>, monthsOfExpenses: { value: null, status: "UNCONFIRMED" } satisfies PolicyParameter<number> },
    ),
    control(
      POLICY_KEYS.PERIOD_LOCK,
      "Period lock policy",
      "A period is soft-closed after the month-end checklist completes and locked with an approval. Posting into a LOCKED period is rejected by the ledger. Corrections to a locked period require an UNLOCK_PERIOD approval (RED) and are recorded as correcting entries with full audit trail; prior-period figures are never silently edited.",
      { softCloseRequiresChecklist: true, lockRequiresApproval: true, modificationRisk: "RED" },
    ),
    control(
      POLICY_KEYS.RELATED_PARTY,
      "Related-party transaction policy",
      "All flows with related parties (including the primary customer associated with the owner's father, the owner, and the owner's fiancée) are flagged RELATED_PARTY, tracked separately, and disclosed to the CPA in every CPA package. Terms are documented in writing. The system never opines on whether a related-party arrangement is acceptable; that is professional judgment.",
      { flagAll: true, discloseToCpa: true, requireWrittenTerms: true },
    ),
    control(
      POLICY_KEYS.INTERNATIONAL_WORKER,
      "International worker policy",
      "No non-US worker is classified as an employee or contractor, and no withholding or documentation form is chosen, without professional review by the CPA and, where needed, an attorney. Until reviewed, the worker is UNRESOLVED, payments are recorded to the 'International Worker Payments (Classification Pending)' account, and the tax documentation status is UNKNOWN.",
      { classificationWithoutReview: false, pendingAccountCode: "6060", reviewerRoles: ["CPA", "ATTORNEY"] },
    ),
    control(
      POLICY_KEYS.AI_AUTONOMY,
      "AI autonomy policy",
      "Agents operate at certified capability levels 0-5 per capability key. Level 0: observe only. Level 1: draft for review. Level 2: auto-execute GREEN actions within approved patterns. Level 3: propose YELLOW actions with one-click approval. Level 4: reserved (not available in Phase One). Level 5: reserved (never for RED). Promotion requires passing evaluation thresholds; any control violation demotes the capability to level 0. The language model is never the calculator or the ledger.",
      { levels: [0, 1, 2, 3, 4, 5], maxLevelPhaseOne: 3, redNeverAutonomous: true },
    ),
    control(
      POLICY_KEYS.DATA_SEPARATION,
      "Data separation policy",
      "Household and personal financial data live in a separate system and are never ingested, indexed, retrieved or referenced by the business system. Secrets (EIN, account numbers) are stored only as vault references. Synthetic lab data is always labelled synthetic and is never merged with real company data.",
      { householdDataAccessible: false, secretsAsVaultReferencesOnly: true, syntheticLabelRequired: true },
    ),
  ];
}

/** Latest non-superseded policy for a key (ACTIVE preferred over DRAFT), or undefined. */
export function policyByKey(policies: Policy[], key: string): Policy | undefined {
  const candidates = policies.filter((p) => p.key === key && p.status !== "SUPERSEDED");
  if (!candidates.length) return undefined;
  return candidates.sort((a, b) => (a.status === b.status ? b.version - a.version : a.status === "ACTIVE" ? -1 : 1))[0];
}

/** Read a typed policy parameter; missing -> null with UNCONFIRMED. */
export function policyParameter<T = unknown>(policies: Policy[], key: string, name: string): PolicyParameter<T> {
  const p = policyByKey(policies, key);
  const raw = p?.parameters?.[name];
  if (raw && typeof raw === "object" && "status" in (raw as object) && "value" in (raw as object)) return raw as PolicyParameter<T>;
  if (raw === undefined) return { value: null, status: "UNCONFIRMED", note: `Parameter ${name} not set on ${key}` };
  return { value: raw as T, status: p?.status === "ACTIVE" ? "CONFIRMED" : "UNCONFIRMED" };
}
