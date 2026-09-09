/**
 * Capability matrix: the certified autonomy level per capability.
 *
 * A fresh lab starts every capability at Level 1 (Apprentice) except the
 * money-moving / filing / classification capabilities, which start at Level 0 and
 * are capped at Level 2 (analysis only) for all of Phase One.
 */
import type { CapabilityMatrix, DataStore } from "@/lib/core/contracts";
import type { Actor, AutonomyLevel, CompanyDataset, CompetencyDomain, CompetencyScore, RiskLevel } from "@/lib/core/types";
import { ControlViolationError, TauError } from "@/lib/core/errors";
import { nowISO } from "@/lib/core/dates";
import { requirePermission } from "@/lib/security/rbac";
import type { AuditLog } from "@/lib/core/contracts";

export interface CapabilityDefinition {
  key: string;
  domain: CompetencyDomain;
  label: string;
  defaultLevel: AutonomyLevel;
  maxPhaseOneLevel: AutonomyLevel;
}

export const AUTONOMY_LEVELS: Readonly<Record<AutonomyLevel, { name: string; description: string }>> = Object.freeze({
  0: { name: "Untrained", description: "No demonstrated competence. May observe and study only; every output is treated as a draft for a human to discard or review." },
  1: { name: "Apprentice", description: "Produces analysis and proposals. Every action, including GREEN, is reviewed by a human before it takes effect." },
  2: { name: "Supervised Analyst", description: "Analysis, reports and drafts are trusted for internal use. Still no autonomous actions; a human executes or approves everything." },
  3: { name: "Trusted Operator", description: "Executes GREEN actions autonomously within materiality thresholds. YELLOW actions are drafted and queued for a human." },
  4: { name: "Senior Operator", description: "GREEN autonomous; YELLOW proposals are pre-vetted with full rationale for lightweight human approval. RED is always human-decided." },
  5: { name: "Maximum Safe Autonomy", description: "GREEN and YELLOW actions execute autonomously within materiality thresholds, with full audit trail. RED actions always require human approval and, in Phase One, never execute." },
});

const L = (key: string, domain: CompetencyDomain, label: string, defaultLevel: AutonomyLevel = 1, maxPhaseOneLevel: AutonomyLevel = 5): CapabilityDefinition => ({ key, domain, label, defaultLevel, maxPhaseOneLevel });

export const CAPABILITIES: readonly CapabilityDefinition[] = Object.freeze([
  L("transaction_categorization", "ACCOUNTING_FOUNDATIONS", "Transaction categorization"),
  L("duplicate_detection", "ACCOUNTING_FOUNDATIONS", "Duplicate detection"),
  L("transfer_matching", "ACCOUNTING_FOUNDATIONS", "Transfer matching"),
  L("receipt_matching", "ACCOUNTING_FOUNDATIONS", "Receipt matching"),
  L("journal_entry_drafting", "ACCOUNTING_FOUNDATIONS", "Journal entry drafting"),
  L("journal_entry_posting", "ACCOUNTING_FOUNDATIONS", "Journal entry posting"),
  L("accruals_prepaids", "ADVANCED_ACCOUNTING", "Accruals and prepaids"),
  L("depreciation", "ADVANCED_ACCOUNTING", "Depreciation"),
  L("bank_reconciliation", "ACCOUNTING_FOUNDATIONS", "Bank reconciliation"),
  L("financial_statements", "FINANCIAL_STATEMENT_ANALYSIS", "Financial statements"),
  L("period_close", "ADVANCED_ACCOUNTING", "Period close"),
  L("budgeting", "FPA", "Budgeting"),
  L("rolling_forecast", "FPA", "Rolling forecast"),
  L("variance_analysis", "FPA", "Variance analysis"),
  L("scenario_analysis", "FPA", "Scenario analysis"),
  L("thirteen_week_cash", "CASH_MANAGEMENT", "13-week cash flow"),
  L("liquidity_monitoring", "CASH_MANAGEMENT", "Liquidity monitoring"),
  L("ar_invoicing", "AP_AR", "AR invoicing"),
  L("ar_collections", "AP_AR", "AR collections"),
  L("ap_bill_intake", "AP_AR", "AP bill intake"),
  L("ap_payment_scheduling", "AP_AR", "AP payment scheduling"),
  L("payment_execution", "CASH_MANAGEMENT", "Payment execution", 0, 2),
  L("payroll_monitoring", "PAYROLL_WORKFORCE", "Payroll monitoring"),
  L("payroll_reconciliation", "PAYROLL_WORKFORCE", "Payroll reconciliation"),
  L("payroll_execution", "PAYROLL_WORKFORCE", "Payroll execution", 0, 2),
  L("worker_classification", "PAYROLL_WORKFORCE", "Worker classification", 0, 2),
  L("international_worker_compliance", "PAYROLL_WORKFORCE", "International worker compliance", 0, 2),
  L("tax_calendar", "TAX_OPERATIONS", "Tax calendar"),
  L("tax_workpapers", "TAX_OPERATIONS", "Tax workpapers"),
  L("tax_filing", "TAX_OPERATIONS", "Tax filing", 0, 2),
  L("cpa_package", "TAX_OPERATIONS", "CPA package"),
  L("document_classification", "FINANCIAL_CONTROLS", "Document classification"),
  L("retention_management", "FINANCIAL_CONTROLS", "Retention management"),
  L("strategic_analysis", "CFO_STRATEGY", "Strategic analysis"),
  L("investment_analysis", "CORPORATE_FINANCE", "Investment analysis"),
  L("pricing_analysis", "CFO_STRATEGY", "Pricing analysis"),
  L("hiring_analysis", "CFO_STRATEGY", "Hiring analysis"),
  L("internal_audit", "FINANCIAL_CONTROLS", "Internal audit"),
  L("policy_management", "FINANCIAL_CONTROLS", "Policy management"),
  L("education", "CFO_STRATEGY", "Education"),
]);

const BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));

export function capabilityDefinition(key: string): CapabilityDefinition {
  const def = BY_KEY.get(key);
  if (!def) throw new TauError("UNKNOWN_CAPABILITY", `Unknown capability key: ${key}`, { key });
  return def;
}

export function isCapabilityKey(key: string): boolean {
  return BY_KEY.has(key);
}

/** Minimum level at which a risk level may be executed without a human. RED is never autonomous. */
export const AUTO_EXECUTE_MIN_LEVEL: Readonly<Record<RiskLevel, AutonomyLevel | null>> = Object.freeze({ GREEN: 3, YELLOW: 5, RED: null });

export interface CapabilityMatrixOptions {
  audit?: AuditLog;
  now?: () => string;
}

export class CapabilityMatrixImpl implements CapabilityMatrix {
  private readonly now: () => string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: DataStore,
    private readonly dataset: CompanyDataset,
    private readonly opts: CapabilityMatrixOptions = {},
  ) {
    this.now = opts.now ?? nowISO;
  }

  private score(key: string): CompetencyScore | undefined {
    return this.dataset.competencyScores.find((s) => s.capabilityKey === key);
  }

  getLevel(capabilityKey: string): AutonomyLevel {
    const def = capabilityDefinition(capabilityKey);
    const s = this.score(capabilityKey);
    const level = s ? s.currentLevel : def.defaultLevel;
    return Math.min(level, def.maxPhaseOneLevel) as AutonomyLevel;
  }

  maxLevel(capabilityKey: string): AutonomyLevel {
    return capabilityDefinition(capabilityKey).maxPhaseOneLevel;
  }

  setLevel(capabilityKey: string, level: AutonomyLevel, actor: Actor, reason: string): void {
    const def = capabilityDefinition(capabilityKey);
    if (!reason || !reason.trim()) throw new ControlViolationError("A reason is required to change a capability level", { capabilityKey });
    if (actor.type === "AGENT" || actor.role === "AGENT") throw new ControlViolationError("An agent cannot change its own capability level", { capabilityKey });
    requirePermission(actor, "MANAGE_CAPABILITIES");
    if (!Number.isInteger(level) || level < 0 || level > 5) throw new ControlViolationError(`Invalid autonomy level ${level}`, { capabilityKey });
    if (level > def.maxPhaseOneLevel) {
      throw new ControlViolationError(`${capabilityKey} is capped at Level ${def.maxPhaseOneLevel} (${AUTONOMY_LEVELS[def.maxPhaseOneLevel].name}) in Phase One`, {
        capabilityKey,
        requested: level,
        maxPhaseOneLevel: def.maxPhaseOneLevel,
      });
    }
    const existing = this.score(capabilityKey);
    const previous = existing?.currentLevel ?? def.defaultLevel;
    const record: CompetencyScore = existing
      ? { ...existing, currentLevel: level, maxAllowedLevel: def.maxPhaseOneLevel }
      : {
          capabilityKey,
          domain: def.domain,
          label: def.label,
          currentLevel: level,
          maxAllowedLevel: def.maxPhaseOneLevel,
          passRate: 0,
          metrics: {},
          evaluationCount: 0,
          consecutivePassingRuns: 0,
          failureCaseIds: [],
          promotionEligible: false,
          promotionBlockers: [],
        };
    if (existing) {
      const idx = this.dataset.competencyScores.indexOf(existing);
      this.dataset.competencyScores[idx] = record;
    } else this.dataset.competencyScores.push(record);
    // The contract is synchronous: the in-memory dataset is updated immediately; persistence
    // and the audit event are queued. Call `flush()` to await them.
    const audit = this.opts.audit;
    const at = this.now();
    const work = async () => {
      await this.store.upsert("competencyScores", record);
      await audit?.record({
        actor,
        workflowVersion: "capability-matrix:v1",
        eventType: "CAPABILITY_LEVEL_CHANGED",
        explanation: `${capabilityKey} level ${previous} → ${level} (${AUTONOMY_LEVELS[level].name}). Reason: ${reason}`,
        beforeState: { capabilityKey, level: previous },
        afterState: { capabilityKey, level, at },
      });
    };
    this.pending = this.pending.then(work, work);
    this.pending.catch(() => undefined);
  }

  /** Await queued persistence / audit writes from setLevel(). */
  async flush(): Promise<void> {
    await this.pending;
  }

  list(): { capabilityKey: string; domain: CompetencyDomain; level: AutonomyLevel; label: string }[] {
    return CAPABILITIES.map((c) => ({ capabilityKey: c.key, domain: c.domain, level: this.getLevel(c.key), label: c.label }));
  }

  mayAutoExecute(capabilityKey: string, risk: RiskLevel): boolean {
    if (risk === "RED") return false;
    const min = AUTO_EXECUTE_MIN_LEVEL[risk];
    if (min === null) return false;
    return this.getLevel(capabilityKey) >= min;
  }
}
