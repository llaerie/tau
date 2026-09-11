/**
 * Shared, side-effect-free helpers for monitors and workflows: item construction, cash position,
 * 13-week forecast assembly, tax obligation resolution and policy lookups that never guess.
 */
import type { LedgerEngine, MaterialityThresholds } from "@/lib/core/contracts";
import type { BankAccount, CalcResult, CompanyDataset, ConfigField, DecimalString, ID, ISODate, Policy, TaxObligation, Transaction } from "@/lib/core/types";
import { yearOf } from "@/lib/core/dates";
import { deterministicId } from "@/lib/core/ids";
import { D, add, money } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { buildThirteenWeekForecast, flowsFromDataset, type DerivedFlows, type ThirteenWeekForecast } from "@/lib/forecasting/thirteen-week";
import { POLICY_KEYS, policyParameter } from "@/lib/knowledge/policies";
import { hasBookData } from "@/lib/db/workspace";
import { buildTaxCalendar } from "@/lib/tax/calendar";
import type { TaxRuleStore } from "@/lib/tax/rule-store";
import { SEVERITY_RANK, type AttentionItem, type AttentionSeverity, type MonitorContext } from "./types";

export const RECEIPT_THRESHOLD_CONFIG_KEY = "expense_policy.receipt_required_above";

export interface ItemSpec {
  kind: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  amount?: DecimalString | number;
  dueDate?: ISODate;
  relatedIds?: ID[];
  suggestedTask?: AttentionItem["suggestedTask"];
  calcIds?: ID[];
  sourceIds?: ID[];
}

/** Build an attention item with a deterministic id (kind + title + related ids; independent of the day). */
export function makeItem(ctx: Pick<MonitorContext, "asOf">, spec: ItemSpec): AttentionItem {
  const relatedIds = uniq(spec.relatedIds ?? []);
  return {
    id: deterministicId("attn", spec.kind, spec.title, ...relatedIds),
    kind: spec.kind,
    severity: spec.severity,
    title: spec.title,
    detail: spec.detail,
    amount: spec.amount === undefined ? undefined : money(spec.amount),
    dueDate: spec.dueDate,
    relatedIds,
    suggestedTask: spec.suggestedTask,
    calcIds: uniq(spec.calcIds ?? []),
    sourceIds: uniq(spec.sourceIds ?? relatedIds),
    createdAt: `${ctx.asOf}T00:00:00.000Z`,
  };
}

export function uniq<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}

/** Deterministic ordering: severity desc, then kind, then id. */
export function sortItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function median(values: readonly DecimalString[]): DecimalString {
  const sorted = values.map(D).sort((a, b) => a.cmp(b));
  const n = sorted.length;
  if (!n) return money(0);
  return n % 2 ? money(sorted[(n - 1) / 2]) : money(sorted[n / 2 - 1].plus(sorted[n / 2]).div(2));
}

export function merchantKey(tx: Transaction): string {
  return (tx.merchantNormalized ?? tx.descriptionRaw).trim().toLowerCase();
}

/** Outflows that are real spend: negative, not transfers, not marked duplicates. */
export function isSpendOutflow(tx: Transaction): boolean {
  return D(tx.amount).lt(0) && !tx.flags.includes("TRANSFER") && !tx.transferPairId && !tx.duplicateOfId;
}

// ---------------------------------------------------------------------------
// Cash position
// ---------------------------------------------------------------------------

export interface CashAccountBalance {
  bankAccountId: ID;
  name: string;
  glAccountId: ID;
  balance: DecimalString;
}

export interface CashPosition {
  asOf: ISODate;
  accounts: CashAccountBalance[];
  /** Sum of cash GL balances. Meaningful only when `known`; otherwise a structural 0.0000 placeholder. */
  total: DecimalString;
  /** false when the ledger has no posted activity: cash is UNKNOWN (no bank data), never 0.00. */
  known: boolean;
  calc: CalcResult<{ accounts: CashAccountBalance[]; total: DecimalString | null; known: boolean }>;
}

export const CASH_UNKNOWN_ASSUMPTION_KEY = "cash_unknown_no_book_data";

/**
 * Cash per bank account from the ledger (GL balances of each account's cash GL). With no posted
 * activity the position is UNKNOWN: `known` is false, the calc value is null and an UNCONFIRMED
 * assumption records why. Callers must never present `total` as a balance when `known` is false.
 */
export function cashPosition(dataset: CompanyDataset, ledger: LedgerEngine, asOf: ISODate): CashPosition {
  const known = hasBookData(dataset);
  // One row per GL account: registered accounts that share a GL are reported once, never double-counted.
  const accounts: CashAccountBalance[] = [];
  const mapped = new Set<ID>();
  for (const b of dataset.bankAccounts as BankAccount[]) {
    if (mapped.has(b.glAccountId)) continue;
    mapped.add(b.glAccountId);
    const sharing = dataset.bankAccounts.filter((x) => x.glAccountId === b.glAccountId);
    accounts.push({ bankAccountId: b.id, name: sharing.length > 1 ? `${b.name} (+${sharing.length - 1} sharing this GL account)` : b.name, glAccountId: b.glAccountId, balance: ledger.accountBalance(b.glAccountId, asOf) });
  }
  // Cash GL accounts not mapped to a bank account still count as cash.
  for (const a of dataset.accounts) {
    if (a.subtype === "CASH" && a.isActive && !mapped.has(a.id)) {
      const bal = ledger.accountBalance(a.id, asOf);
      if (!D(bal).isZero()) accounts.push({ bankAccountId: a.id, name: `${a.code} ${a.name} (no bank account mapped)`, glAccountId: a.id, balance: bal });
    }
  }
  const total = accounts.reduce((acc, a) => add(acc, a.balance), money(0));
  const calc = makeCalc({
    name: "cash_position",
    value: { accounts, total: known ? total : null, known },
    unit: "USD",
    formula: "cash_total = sum(GL balance of every cash account as of date); UNKNOWN (null) when no entry has been posted",
    inputs: { asOf, known, balances: accounts.map((a) => ({ glAccountId: a.glAccountId, balance: a.balance })) },
    sourceIds: accounts.map((a) => a.glAccountId),
    asOfDate: asOf,
    notes: known ? undefined : ["INSUFFICIENT_INFORMATION: no posted ledger activity — no bank data has been entered or imported, so cash is unknown (not zero)."],
    assumptions: known ? undefined : [{ key: CASH_UNKNOWN_ASSUMPTION_KEY, description: "Cash position is UNKNOWN — no bank data. 0.0000 appears only as a structural placeholder in downstream forecasts.", value: null, status: "UNCONFIRMED" }],
  });
  return { asOf, accounts, total, known, calc };
}

// ---------------------------------------------------------------------------
// 13-week forecast from the dataset
// ---------------------------------------------------------------------------

export interface ThirteenWeekBundle {
  forecast: ThirteenWeekForecast;
  flows: DerivedFlows;
  cash: CashPosition;
}

export function thirteenWeekFor(dataset: CompanyDataset, ledger: LedgerEngine, thresholds: MaterialityThresholds, asOf: ISODate): ThirteenWeekBundle {
  const cash = cashPosition(dataset, ledger, asOf);
  const flows = flowsFromDataset(dataset, asOf);
  if (!cash.known) flows.assumptions.unshift(openingCashUnknownAssumption());
  const forecast = buildThirteenWeekForecast({
    asOfDate: asOf,
    openingCash: cash.total,
    receipts: flows.receipts,
    disbursements: flows.disbursements,
    minimumCash: thresholds.minimumCashReserve,
    assumptions: flows.assumptions,
    sourceIds: [cash.calc.id],
  });
  return { forecast, flows, cash };
}

export const OPENING_CASH_UNKNOWN_KEY = "opening_cash_unknown";

/** Assumption attached to any forecast built on an unknown opening balance. */
export function openingCashUnknownAssumption() {
  return { key: OPENING_CASH_UNKNOWN_KEY, description: "Opening cash is UNKNOWN — no posted bank/ledger activity. The forecast's 0.0000 opening is a structural placeholder, not a balance; closing figures are not cash projections until bank data exists.", value: null, status: "UNCONFIRMED" as const };
}

// ---------------------------------------------------------------------------
// Tax obligations (never invent due dates)
// ---------------------------------------------------------------------------

/** Dataset obligations when present; otherwise the calendar derived from the rule store for the prior and current tax years. */
export function taxObligationsFor(dataset: CompanyDataset, taxRules: TaxRuleStore, asOf: ISODate): TaxObligation[] {
  if (dataset.taxObligations.length) return dataset.taxObligations;
  const year = yearOf(asOf);
  return [...buildTaxCalendar(dataset, year - 1, taxRules, asOf), ...buildTaxCalendar(dataset, year, taxRules, asOf)];
}

// ---------------------------------------------------------------------------
// Receipt threshold (null when nobody confirmed one)
// ---------------------------------------------------------------------------

export function receiptThresholdFor(configFields: ConfigField[], policies: Policy[]): DecimalString | null {
  const confirmed = configFields.find((f) => f.key === RECEIPT_THRESHOLD_CONFIG_KEY && f.status === "CONFIRMED" && f.value !== null && f.value !== undefined);
  if (confirmed && (typeof confirmed.value === "string" || typeof confirmed.value === "number")) {
    try {
      return money(confirmed.value);
    } catch {
      return null;
    }
  }
  const param = policyParameter<string>(policies, POLICY_KEYS.EXPENSE_DOCUMENTATION, "receiptThreshold");
  if (param.status === "CONFIRMED" && param.value !== null) return money(param.value);
  return null;
}

/** Latest APPROVED budget for a fiscal year (highest version). */
export function approvedBudgetFor(dataset: CompanyDataset, fiscalYear: number) {
  return dataset.budgets
    .filter((b) => b.status === "APPROVED" && b.fiscalYear === fiscalYear)
    .sort((a, b) => b.version - a.version)[0];
}
