/**
 * Synthetic S-corporation dataset generator for the Tau AI CFO Phase One lab.
 *
 * `generateSyntheticCompany()` builds "Northlight AI Services LLC (SYNTHETIC)": 15 full months of
 * bank, card, payroll, AR/AP and adjusting activity, fully posted through the real `Ledger`, with
 * a catalogue of deliberately difficult cases described by `SYNTHETIC_GROUND_TRUTH`.
 *
 * Deterministic: the same seed + asOfDate + startMonth always yields byte-identical JSON.
 * Nothing here is a real company fact — every record is labelled synthetic.
 */
import { Ledger } from "@/lib/accounting/ledger";
import { lockTagAt } from "@/lib/accounting/periods";
import { addDays, addMonths, isValidISODate, monthStart } from "@/lib/core/dates";
import { emptyDataset, type ApprovalRequest, type CompanyDataset, type ISODate } from "@/lib/core/types";
import { generateBills } from "./bills";
import { buildCompany, buildProfile } from "./company";
import { GenContext, OPERATOR_ACTOR, OWNER_ACTOR, sid, ts } from "./context";
import { generateDifficultCases } from "./difficult-cases";
import { generateDocuments, linkDocumentsToEntries } from "./documents";
import { buildGroundTruth, type GroundTruthCase } from "./ground-truth";
import { finalizeInvoiceStatuses, generateInvoicing } from "./invoicing";
import { generatePayroll } from "./payroll";
import { generatePlanning } from "./planning";
import { generateCardPayments, generateRecurringTransactions } from "./transactions";

export type { GroundTruthCase } from "./ground-truth";
export { GROUND_TRUTH_DEFINITIONS } from "./ground-truth";
export { SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS, computePayrollLine, payrollTotals } from "./payroll";
export { SYNTHETIC_COMPANY_ID, SYNTHETIC_DISPLAY_NAME } from "./company";
export { GENERATOR_ACTOR, OPERATOR_ACTOR, OWNER_ACTOR, SYNTHETIC_NAMESPACE } from "./context";
export { DISTRIBUTION_APPROVAL_ID } from "./difficult-cases";

export const DEFAULT_SYNTHETIC_SEED = 20260101;
export const DEFAULT_AS_OF_DATE: ISODate = "2026-09-09";
export const DEFAULT_TIMELINE_MONTHS = 15;
export const LOCK_APPROVAL_ID = "apr_synthetic_lock";
/** The generator needs this many months to place every difficult case. */
export const MIN_TIMELINE_MONTHS = 13;

export interface SyntheticCompanyOptions {
  seed?: number;
  asOfDate?: ISODate;
  /** YYYY-MM; defaults to 15 months before asOfDate (≥ 12 full months plus the current partial month). */
  startMonth?: string;
}

export interface SyntheticCompanyDataset extends CompanyDataset {
  /** Expected treatment of every deliberately difficult case, with the concrete ids in this dataset. */
  groundTruth: GroundTruthCase[];
}

export function defaultStartMonth(asOfDate: ISODate): string {
  return addMonths(monthStart(asOfDate), -DEFAULT_TIMELINE_MONTHS).slice(0, 7);
}

export function generateSyntheticCompany(options: SyntheticCompanyOptions = {}): SyntheticCompanyDataset {
  const seed = options.seed ?? DEFAULT_SYNTHETIC_SEED;
  const asOfDate = options.asOfDate ?? DEFAULT_AS_OF_DATE;
  if (!isValidISODate(asOfDate)) throw new Error(`Invalid asOfDate: ${asOfDate}`);
  const startMonth = options.startMonth ?? defaultStartMonth(asOfDate);
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !isValidISODate(`${startMonth}-01`)) throw new Error(`Invalid startMonth: ${startMonth}`);
  if (`${startMonth}-01` > asOfDate) throw new Error(`startMonth ${startMonth} is after asOfDate ${asOfDate}`);

  const ds = emptyDataset(buildProfile(asOfDate));
  const ctx = new GenContext(ds, { seed, asOfDate, startMonth });
  if (ctx.months.length < MIN_TIMELINE_MONTHS) {
    throw new Error(`Synthetic timeline from ${startMonth} to ${asOfDate} spans ${ctx.months.length} months; at least ${MIN_TIMELINE_MONTHS} are required`);
  }

  // 1. Records (transactions, subledgers, documents) — postings are queued, not yet applied.
  buildCompany(ctx);
  generateRecurringTransactions(ctx);
  generatePayroll(ctx);
  generateInvoicing(ctx);
  generateBills(ctx);
  generateDifficultCases(ctx);
  generateCardPayments(ctx);
  generateDocuments(ctx);
  generatePlanning(ctx);

  // 2. Ledger: apply every posting in date order through the real engine.
  const ledger = runLedgerPhase(ctx);
  finalizeInvoiceStatuses(ctx);
  linkDocumentsToEntries(ctx);

  // 3. Period control: soft-close history, lock the two earliest months with an approval.
  closePeriods(ctx, ledger);
  normalizeTimestamps(ctx);
  sortCollections(ctx);

  // Company configuration fields are owned by the knowledge layer
  // (lib/knowledge/synthetic-profile.ts → buildSyntheticProfileFields()); runtime wiring populates them.
  ds.configFields = [];

  return Object.assign(ds, { groundTruth: buildGroundTruth(ctx) });
}

function runLedgerPhase(ctx: GenContext): Ledger {
  const ledger = new Ledger(ctx.ds);
  for (const m of ctx.months) ledger.ensurePeriod(`${m}-01`);
  const ordered = [...ctx.postings].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
  for (const p of ordered) p.run(ledger);
  return ledger;
}

function lockApproval(ctx: GenContext, periodIds: string[]): ApprovalRequest {
  const at = ts(`${ctx.priorMonth}-01`, 9);
  const actionId = sid("act", "lock-periods");
  return {
    id: LOCK_APPROVAL_ID,
    action: {
      id: actionId,
      kind: "LOCK_PERIOD",
      agent: "USER",
      description: `Lock accounting periods ${periodIds.join(", ")} after close review`,
      targetIds: periodIds,
      payload: { periodIds, isSynthetic: true },
      reason: "Month-end close completed and reviewed; suspense is zero and integrity checks pass.",
      sourceDocumentIds: [],
      confidence: 1,
      reversible: true,
      rollbackPlan: "Unlock with a new approval and a documented reason.",
      createdAt: at,
      context: { periodStatus: "SOFT_CLOSED" },
    },
    risk: { actionId, level: "YELLOW", reasons: ["Period lock is a control change"], requiredApproverRoles: ["OWNER"], materialityBreached: false, autoExecutable: false, policyRefs: ["period-close"], assessedAt: at },
    requestedApproverRoles: ["OWNER"],
    status: "APPROVED",
    requestedAt: at,
    decidedAt: ts(`${ctx.priorMonth}-01`, 11),
    decidedBy: OWNER_ACTOR.id,
    decidedByRole: "OWNER",
    decisionComment: "Approved (synthetic lab approval).",
    auditEventIds: [],
  };
}

function closePeriods(ctx: GenContext, ledger: Ledger): void {
  const closable = ctx.ds.periods.filter((p) => p.id < ctx.priorMonth).map((p) => p.id).sort();
  for (const id of closable) ledger.softClosePeriod(id, OPERATOR_ACTOR);
  const toLock = closable.slice(0, 2);
  if (!toLock.length) return;
  ctx.ds.approvals.push(lockApproval(ctx, toLock));
  for (const id of toLock) ledger.lockPeriod(id, OPERATOR_ACTOR, LOCK_APPROVAL_ID);
}

/** The ledger stamps wall-clock times; replace them with times derived from the record dates. */
function normalizeTimestamps(ctx: GenContext): void {
  for (const e of ctx.ds.journalEntries) {
    e.createdAt = ts(e.date, 9);
    if (e.postedAt) e.postedAt = ts(e.date, 9, 5);
  }
  for (const p of ctx.ds.periods) {
    const softAt = ts(addDays(p.endDate, 10), 9);
    if (p.status === "SOFT_CLOSED") p.tags = [`soft-closed:${softAt}:${OPERATOR_ACTOR.id}`];
    if (p.status === "LOCKED") {
      const lockedAt = ts(addDays(p.endDate, 12), 10);
      p.lockedAt = lockedAt;
      p.tags = [`soft-closed:${softAt}:${OPERATOR_ACTOR.id}`, lockTagAt(OPERATOR_ACTOR.id, p.lockApprovalId ?? LOCK_APPROVAL_ID, lockedAt)];
    }
  }
}

function sortCollections(ctx: GenContext): void {
  const byDate = <T extends { date: string }>(arr: T[]) => arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  byDate(ctx.ds.transactions);
  byDate(ctx.ds.documents);
  byDate(ctx.ds.payments);
}

let defaultGroundTruth: GroundTruthCase[] | undefined;
function groundTruthForDefaults(): GroundTruthCase[] {
  if (!defaultGroundTruth) defaultGroundTruth = generateSyntheticCompany().groundTruth;
  return defaultGroundTruth;
}

/** Ground truth for the default dataset (`generateSyntheticCompany()` with no options). Built lazily on first access. */
export const SYNTHETIC_GROUND_TRUTH: readonly GroundTruthCase[] = new Proxy([] as GroundTruthCase[], {
  get(_target, prop, receiver) {
    return Reflect.get(groundTruthForDefaults(), prop, receiver);
  },
  has(_target, prop) {
    return Reflect.has(groundTruthForDefaults(), prop);
  },
  ownKeys() {
    return Reflect.ownKeys(groundTruthForDefaults());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(groundTruthForDefaults(), prop);
  },
});

/** Look up one ground-truth case by key. Pass a dataset to read that dataset's ids; defaults to the default dataset. */
export function getGroundTruthCase(key: string, dataset?: SyntheticCompanyDataset): GroundTruthCase | undefined {
  const cases = dataset ? dataset.groundTruth : groundTruthForDefaults();
  return cases.find((c) => c.key === key);
}
