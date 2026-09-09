import { emptyDataset } from "@/lib/core/types";
import type { Actor, CompanyDataset, CompanyProfile, ProposedAction, ActionKind, Money } from "@/lib/core/types";
import { MemoryStore } from "@/lib/db/memory-store";
import { HashChainedAuditLog } from "@/lib/audit/audit-log";
import { ApprovalEngineImpl } from "@/lib/approvals/approval-engine";
import { RuleBasedRiskEngine } from "@/lib/risk/risk-engine";
import { DEFAULT_MATERIALITY } from "@/lib/risk/materiality";

export const T0 = "2026-09-09T12:00:00.000Z";

/** Deterministic, advanceable clock. */
export function makeClock(start = T0) {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t).toISOString(),
    nowMs: () => t,
    advanceDays: (d: number) => {
      t += d * 86_400_000;
    },
    advanceMs: (ms: number) => {
      t += ms;
    },
  };
}

export function profile(): CompanyProfile {
  const cf = <T,>(key: string, value: T | null): CompanyProfile["entityType"] => ({ key, section: "entity", label: key, value: value as string | null, status: "UNCONFIRMED", synthetic: true });
  return {
    id: "co_test",
    displayName: "Test Co (synthetic)",
    isSynthetic: true,
    entityType: cf("entityType", "S_CORP"),
    taxElection: cf("taxElection", "S_CORP"),
    state: cf("state", "CA"),
    fiscalYearEnd: cf("fiscalYearEnd", "12-31"),
    accountingMethod: { key: "accountingMethod", section: "entity", label: "method", value: "ACCRUAL", status: "UNCONFIRMED" },
    functionalCurrency: "USD",
    asOfDate: "2026-09-09",
  };
}

export function makeDataset(): CompanyDataset {
  return emptyDataset(profile());
}

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${String(seq).padStart(6, "0")}`;
}

export function makeGovernance(opts: { clock?: ReturnType<typeof makeClock> } = {}) {
  const clock = opts.clock ?? makeClock();
  const dataset = makeDataset();
  const store = new MemoryStore(dataset);
  const audit = new HashChainedAuditLog(store, dataset, { now: clock.now, idFn: () => nextId("aud") });
  const approvals = new ApprovalEngineImpl(store, dataset, audit, { now: clock.now, idFn: () => nextId("apr") });
  const risk = new RuleBasedRiskEngine({ now: clock.now, restrictedAccountIds: ["acct_3100", "acct_2500"] });
  return { clock, dataset, store, audit, approvals, risk, thresholds: DEFAULT_MATERIALITY };
}

export const OWNER: Actor = { type: "USER", id: "u_owner", role: "OWNER", displayName: "Owner" };
export const OPERATOR: Actor = { type: "USER", id: "u_ops", role: "FINANCE_OPERATOR" };
export const CPA: Actor = { type: "USER", id: "u_cpa", role: "CPA" };
export const PAYROLL_PRO: Actor = { type: "USER", id: "u_payroll", role: "PAYROLL_PROFESSIONAL" };
export const ATTORNEY: Actor = { type: "USER", id: "u_atty", role: "ATTORNEY" };
export const VIEWER: Actor = { type: "USER", id: "u_viewer", role: "VIEWER" };
export const AGENT: Actor = { type: "AGENT", id: "bookkeeping", role: "AGENT" };

export function action(kind: ActionKind, overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: nextId("pa"),
    kind,
    agent: "bookkeeping",
    description: `${kind} test action`,
    targetIds: [],
    payload: {},
    reason: "test",
    sourceDocumentIds: [],
    confidence: 0.9,
    reversible: true,
    createdAt: T0,
    ...overrides,
  };
}

export const usd = (amount: string): Money => ({ amount, currency: "USD" });
