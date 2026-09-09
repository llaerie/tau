/**
 * Rule-based risk engine (risk-policy v1).
 *
 * Every proposed action is classified GREEN / YELLOW / RED from its kind, its
 * context flags and the materiality thresholds. The rules are deterministic and
 * cite the policy reference that fired (`policyRefs`) so a reviewer can trace
 * exactly why an action needs approval.
 *
 * Precedence: RED rules always win, then YELLOW, then GREEN. Amount-based
 * materiality escalates on top of the kind-based classification.
 */
import type { MaterialityThresholds, RiskEngine } from "@/lib/core/contracts";
import type { ActionKind, AutonomyLevel, ID, ISODateTime, ProposedAction, RiskAssessment, RiskLevel, Role } from "@/lib/core/types";
import { abs, gte } from "@/lib/core/money";
import { nowISO } from "@/lib/core/dates";

export const RISK_POLICY_VERSION = "risk-policy:v1";

/** Actions that can never execute in Phase One, even with an APPROVED request (simulation only). */
export const PHASE_ONE_PROHIBITED_KINDS: readonly ActionKind[] = Object.freeze([
  "EXECUTE_PAYMENT",
  "RUN_PAYROLL",
  "CHANGE_PAYROLL",
  "FILE_TAX_RETURN",
  "PAY_TAX",
  "SIGN_DOCUMENT",
  "RESPOND_TO_TAX_AUTHORITY",
  "CHANGE_ENTITY",
  "DELETE_RECORD",
]);

export function isPhaseOneProhibited(kind: ActionKind): boolean {
  return PHASE_ONE_PROHIBITED_KINDS.includes(kind);
}

/** Kinds that are inherently RED regardless of context. */
export const ALWAYS_RED_KINDS: readonly ActionKind[] = Object.freeze([
  "FILE_TAX_RETURN",
  "PAY_TAX",
  "EXECUTE_PAYMENT",
  "RUN_PAYROLL",
  "CHANGE_PAYROLL",
  "SET_COMPENSATION_POLICY",
  "RESPOND_TO_TAX_AUTHORITY",
  "CHANGE_ENTITY",
  "CHANGE_ACCOUNTING_POLICY",
  "DELETE_RECORD",
  "MODIFY_CLOSED_PERIOD",
  "UNLOCK_PERIOD",
  "CLASSIFY_INTERNATIONAL_WORKER",
  "SIGN_DOCUMENT",
  "UPDATE_POLICY",
]);

/** Kinds that are YELLOW by default (human review of a draft / proposal). */
export const DEFAULT_YELLOW_KINDS: readonly ActionKind[] = Object.freeze([
  "REIMBURSEMENT",
  "CREATE_VENDOR",
  "CREATE_CUSTOMER",
  "PROPOSE_DISTRIBUTION",
  "SEND_COLLECTION_REMINDER",
  "UPDATE_CONFIG",
  "LOCK_PERIOD",
  "REVERSE_JOURNAL_ENTRY",
  "SCHEDULE_PAYMENT",
  "OTHER",
]);

/** Read-only kinds: the transaction-review amount never forces YELLOW on these (redAmount still applies). */
export const READ_ONLY_KINDS: readonly ActionKind[] = Object.freeze([
  "CALCULATE",
  "GENERATE_REPORT",
  "RUN_RECONCILIATION",
  "FLAG_MISSING_RECEIPT",
]);

const JOURNAL_KINDS: readonly ActionKind[] = ["CREATE_JOURNAL_ENTRY", "POST_JOURNAL_ENTRY", "REVERSE_JOURNAL_ENTRY", "MODIFY_CLOSED_PERIOD"];
const TAX_KINDS: readonly ActionKind[] = ["FILE_TAX_RETURN", "PAY_TAX", "RESPOND_TO_TAX_AUTHORITY"];
const PAYROLL_KINDS: readonly ActionKind[] = ["RUN_PAYROLL", "CHANGE_PAYROLL", "SET_COMPENSATION_POLICY"];
const ENTITY_KINDS: readonly ActionKind[] = ["CHANGE_ENTITY"];
const INTERNATIONAL_KINDS: readonly ActionKind[] = ["CLASSIFY_INTERNATIONAL_WORKER"];
const POLICY_KINDS: readonly ActionKind[] = ["CHANGE_ACCOUNTING_POLICY", "UPDATE_POLICY"];

const RANK: Record<RiskLevel, number> = { GREEN: 0, YELLOW: 1, RED: 2 };

export interface RiskEngineOptions {
  /** Account ids that count as restricted for journal-entry classification (e.g. equity, due to/from shareholder). */
  restrictedAccountIds?: Iterable<ID>;
  /** Clock override for deterministic tests. */
  now?: () => ISODateTime;
}

interface Verdict {
  level: RiskLevel;
  reasons: string[];
  policyRefs: string[];
  materialityBreached: boolean;
}

function payloadAccountIds(action: ProposedAction): ID[] {
  const p = action.payload ?? {};
  const out: ID[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") out.push(v);
  };
  if (Array.isArray(p.accountIds)) p.accountIds.forEach(push);
  if (Array.isArray(p.lines)) {
    for (const l of p.lines) if (l && typeof l === "object") push((l as { accountId?: unknown }).accountId);
  }
  push(p.accountId);
  return out;
}

function isExactMatch(action: ProposedAction): boolean {
  const p = action.payload ?? {};
  if (p.exactMatch === true) return true;
  if (typeof p.matchType === "string") return p.matchType.toUpperCase() === "EXACT";
  return false;
}

function isKnownCounterparty(action: ProposedAction): boolean {
  const ctx = action.context ?? {};
  const p = action.payload ?? {};
  if (ctx.isNewVendor) return false;
  if (p.isNewCounterparty === true) return false;
  return true;
}

export class RuleBasedRiskEngine implements RiskEngine {
  private readonly restricted: Set<ID>;
  private readonly now: () => ISODateTime;

  constructor(opts: RiskEngineOptions = {}) {
    this.restricted = new Set(opts.restrictedAccountIds ?? []);
    this.now = opts.now ?? nowISO;
  }

  assess(action: ProposedAction, ctx: { thresholds: MaterialityThresholds; capabilityLevel?: AutonomyLevel }): RiskAssessment {
    const v = this.classify(action, ctx.thresholds);
    const requiredApproverRoles = this.approverRoles(action, v.level);
    const reasons = [...v.reasons];
    let autoExecutable = v.level === "GREEN";
    if (autoExecutable && ctx.capabilityLevel !== undefined && ctx.capabilityLevel < 3) {
      autoExecutable = false;
      reasons.push(`Capability level ${ctx.capabilityLevel} is below the auto-execution minimum (3); human review required.`);
    }
    if (ctx.thresholds.status !== "CONFIRMED") {
      reasons.push("Materiality thresholds are UNCONFIRMED lab defaults.");
    }
    return {
      actionId: action.id,
      level: v.level,
      reasons,
      requiredApproverRoles,
      materialityBreached: v.materialityBreached,
      autoExecutable,
      policyRefs: Array.from(new Set(v.policyRefs)),
      assessedAt: this.now(),
    };
  }

  private touchesRestrictedAccount(action: ProposedAction): boolean {
    if (action.payload?.touchesRestrictedAccount === true) return true;
    return payloadAccountIds(action).some((id) => this.restricted.has(id));
  }

  private classify(action: ProposedAction, t: MaterialityThresholds): Verdict {
    const c = action.context ?? {};
    const kind = action.kind;
    const reasons: string[] = [];
    const refs: string[] = [];
    let level: RiskLevel = "GREEN";
    let materialityBreached = false;

    const raise = (to: RiskLevel, reason: string, ref: string) => {
      if (RANK[to] > RANK[level]) level = to;
      reasons.push(reason);
      refs.push(`${RISK_POLICY_VERSION}:${to.toLowerCase()}:${ref}`);
    };

    // ---- kind-based base classification --------------------------------------------------
    if (ALWAYS_RED_KINDS.includes(kind)) {
      raise("RED", `${kind} is always RED: requires owner approval and, where relevant, a professional.`, `kind:${kind.toLowerCase()}`);
    } else if (DEFAULT_YELLOW_KINDS.includes(kind)) {
      raise("YELLOW", `${kind} is a draft/proposal that a human must review before it takes effect.`, `kind:${kind.toLowerCase()}`);
    } else if (READ_ONLY_KINDS.includes(kind)) {
      reasons.push(`${kind} is read-only analysis; no records or money move.`);
      refs.push(`${RISK_POLICY_VERSION}:green:kind:${kind.toLowerCase()}`);
    } else if (kind === "UPDATE_FORECAST") {
      if (c.isMaterialForecastChange) raise("YELLOW", "Material forecast change requires review.", "material-forecast-change");
      else {
        reasons.push("Forecast update within materiality; forecasts are not ledger records.");
        refs.push(`${RISK_POLICY_VERSION}:green:kind:update_forecast`);
      }
    } else if (kind === "CATEGORIZE_TRANSACTION") {
      if (c.isNewCategory) raise("YELLOW", "Categorization uses a new category/account.", "new-category");
      else if (c.isPersonalMixed) raise("YELLOW", "Transaction may be personal or mixed-use.", "personal-mixed");
      else if (c.isRecurringApproved) {
        reasons.push("Recurring merchant with an approved categorization pattern.");
        refs.push(`${RISK_POLICY_VERSION}:green:categorize:recurring-approved`);
      } else raise("YELLOW", "Merchant has no approved recurring categorization; review required.", "categorize:unapproved-merchant");
    } else if (kind === "MATCH_PAYMENT") {
      if (isExactMatch(action)) {
        reasons.push("Exact payment match (amount and counterparty).");
        refs.push(`${RISK_POLICY_VERSION}:green:match-payment:exact`);
      } else raise("YELLOW", "Payment match is not exact (partial/fuzzy); review required.", "match-payment:inexact");
    } else if (kind === "RECORD_INVOICE" || kind === "RECORD_BILL") {
      const known = isKnownCounterparty(action);
      const under = action.amount ? !gte(abs(action.amount.amount), t.transactionReviewAmount) : true;
      if (known && under) {
        reasons.push(`${kind} for a known counterparty under the transaction review amount.`);
        refs.push(`${RISK_POLICY_VERSION}:green:${kind.toLowerCase()}:known-counterparty`);
      } else if (!known) raise("YELLOW", `${kind} for a new/unknown counterparty.`, `${kind.toLowerCase()}:new-counterparty`);
    } else if (kind === "CREATE_JOURNAL_ENTRY" || kind === "POST_JOURNAL_ENTRY") {
      if (c.isNonStandard) raise("YELLOW", "Non-standard journal entry.", "journal:non-standard");
      else if (this.touchesRestrictedAccount(action)) raise("YELLOW", "Journal entry touches a restricted account.", "journal:restricted-account");
      else {
        reasons.push("Standard journal entry from a system source.");
        refs.push(`${RISK_POLICY_VERSION}:green:journal:standard`);
      }
    }
    if (kind !== "CREATE_JOURNAL_ENTRY" && kind !== "POST_JOURNAL_ENTRY" && JOURNAL_KINDS.includes(kind) && this.touchesRestrictedAccount(action)) {
      raise("YELLOW", "Entry touches a restricted account.", "journal:restricted-account");
    }

    // ---- context escalations ------------------------------------------------------------
    if (c.isPersonalMixed && kind !== "CATEGORIZE_TRANSACTION") raise("YELLOW", "Involves personal / mixed-use spend.", "personal-mixed");
    if (c.isMaterialForecastChange && kind !== "UPDATE_FORECAST") raise("YELLOW", "Material forecast change.", "material-forecast-change");
    if (c.isNewRecurringExpense) raise("YELLOW", "Establishes a new recurring expense.", "new-recurring-expense");
    if (c.involvesRelatedParty && RANK[level] < RANK.YELLOW) raise("YELLOW", "Related-party involvement requires review.", "related-party");
    if (kind === "SCHEDULE_PAYMENT" && c.movesMoney) raise("RED", "Scheduling a payment that moves money.", "schedule-payment:moves-money");
    if (c.movesMoney) raise("RED", "Action moves money.", "moves-money");
    if (JOURNAL_KINDS.includes(kind) && c.periodStatus === "LOCKED") raise("RED", "Journal action targets a LOCKED period.", "locked-period");
    if (c.touchesTax && (c.isNonStandard || c.isPersonalMixed || c.involvesRelatedParty)) raise("RED", "Unusual action touching tax.", "tax-unusual");

    // ---- materiality by amount ----------------------------------------------------------
    if (action.amount) {
      const amt = abs(action.amount.amount);
      if (gte(amt, t.redAmount)) {
        materialityBreached = true;
        raise("RED", `Amount ${amt} ${action.amount.currency} is at or above the RED amount (${t.redAmount}).`, "materiality:red-amount");
      } else if (gte(amt, t.transactionReviewAmount) && !READ_ONLY_KINDS.includes(kind)) {
        materialityBreached = true;
        raise("YELLOW", `Amount ${amt} ${action.amount.currency} is at or above the transaction review amount (${t.transactionReviewAmount}).`, "materiality:review-amount");
      }
    }

    return { level, reasons, policyRefs: refs, materialityBreached };
  }

  private approverRoles(action: ProposedAction, level: RiskLevel): Role[] {
    if (level === "GREEN") return [];
    if (level === "YELLOW") return ["OWNER", "FINANCE_OPERATOR"];
    const c = action.context ?? {};
    const roles = new Set<Role>(["OWNER"]);
    const k = action.kind;
    if (TAX_KINDS.includes(k) || c.touchesTax) roles.add("CPA");
    if (PAYROLL_KINDS.includes(k) || c.touchesPayroll) roles.add("PAYROLL_PROFESSIONAL");
    if (INTERNATIONAL_KINDS.includes(k) || ENTITY_KINDS.includes(k)) {
      roles.add("ATTORNEY");
      roles.add("CPA");
    }
    if (POLICY_KINDS.includes(k)) roles.add("CPA");
    return Array.from(roles);
  }
}

/** Convenience: the professional roles (everything except OWNER) in a RED approver list. */
export function professionalRoles(roles: Role[]): Role[] {
  return roles.filter((r) => r !== "OWNER" && r !== "FINANCE_OPERATOR");
}
