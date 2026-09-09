import { Prisma, type PrismaClient } from "@prisma/client";
import type { DataStore, Entity } from "@/lib/core/contracts";
import type { AuditEvent, CollectionName, CompanyDataset } from "@/lib/core/types";
import { getPrismaClient } from "./prisma-client";
import * as M from "./mappers";

type Tx = Prisma.TransactionClient;

/** createMany batches; keeps each statement well under Postgres' parameter limit. */
const CHUNK = 500;
async function chunked<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
}

/** Per-collection persistence operations. `insertMany` assumes the table is empty (reset). */
interface CollectionOps<K extends CollectionName> {
  upsert(tx: Tx, entity: Entity<K>): Promise<void>;
  insertMany(tx: Tx, entities: Entity<K>[]): Promise<void>;
}

const journalEntryOps: CollectionOps<"journalEntries"> = {
  async upsert(tx, e) {
    const { entry, lines } = M.toJournalEntryRows(e);
    await tx.journalEntry.upsert({ where: { id: entry.id }, create: entry, update: entry });
    await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
    await tx.journalLine.createMany({ data: lines });
  },
  async insertMany(tx, entities) {
    const rows = entities.map(M.toJournalEntryRows);
    await chunked(rows.map((r) => r.entry), (data) => tx.journalEntry.createMany({ data }));
    await chunked(rows.flatMap((r) => r.lines), (data) => tx.journalLine.createMany({ data }));
  },
};

const invoiceOps: CollectionOps<"invoices"> = {
  async upsert(tx, e) {
    const { invoice, lines } = M.toInvoiceRows(e);
    await tx.invoice.upsert({ where: { id: invoice.id }, create: invoice, update: invoice });
    await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoiceLine.createMany({ data: lines });
  },
  async insertMany(tx, entities) {
    const rows = entities.map(M.toInvoiceRows);
    await chunked(rows.map((r) => r.invoice), (data) => tx.invoice.createMany({ data }));
    await chunked(rows.flatMap((r) => r.lines), (data) => tx.invoiceLine.createMany({ data }));
  },
};

const OPS: { [K in CollectionName]: CollectionOps<K> } = {
  accounts: {
    upsert: async (tx, e) => void (await tx.account.upsert(byId(M.toAccountRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toAccountRow), (data) => tx.account.createMany({ data })),
  },
  periods: {
    upsert: async (tx, e) => void (await tx.period.upsert(byId(M.toPeriodRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toPeriodRow), (data) => tx.period.createMany({ data })),
  },
  journalEntries: journalEntryOps,
  bankAccounts: {
    upsert: async (tx, e) => void (await tx.bankAccount.upsert(byId(M.toBankAccountRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toBankAccountRow), (data) => tx.bankAccount.createMany({ data })),
  },
  cards: {
    upsert: async (tx, e) => void (await tx.card.upsert(byId(M.toCardRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toCardRow), (data) => tx.card.createMany({ data })),
  },
  transactions: {
    upsert: async (tx, e) => void (await tx.transaction.upsert(byId(M.toTransactionRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toTransactionRow), (data) => tx.transaction.createMany({ data })),
  },
  vendors: {
    upsert: async (tx, e) => void (await tx.vendor.upsert(byId(M.toVendorRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toVendorRow), (data) => tx.vendor.createMany({ data })),
  },
  customers: {
    upsert: async (tx, e) => void (await tx.customer.upsert(byId(M.toCustomerRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toCustomerRow), (data) => tx.customer.createMany({ data })),
  },
  invoices: invoiceOps,
  bills: {
    upsert: async (tx, e) => void (await tx.bill.upsert(byId(M.toBillRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toBillRow), (data) => tx.bill.createMany({ data })),
  },
  payments: {
    upsert: async (tx, e) => void (await tx.payment.upsert(byId(M.toPaymentRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toPaymentRow), (data) => tx.payment.createMany({ data })),
  },
  workers: {
    upsert: async (tx, e) => void (await tx.worker.upsert(byId(M.toWorkerRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toWorkerRow), (data) => tx.worker.createMany({ data })),
  },
  payrollRuns: {
    upsert: async (tx, e) => void (await tx.payrollRun.upsert(byId(M.toPayrollRunRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toPayrollRunRow), (data) => tx.payrollRun.createMany({ data })),
  },
  payrollLiabilities: {
    upsert: async (tx, e) => void (await tx.payrollLiability.upsert(byId(M.toPayrollLiabilityRow(e)))),
    insertMany: (tx, es) =>
      chunked(es.map(M.toPayrollLiabilityRow), (data) => tx.payrollLiability.createMany({ data })),
  },
  taxObligations: {
    upsert: async (tx, e) => void (await tx.taxObligation.upsert(byId(M.toTaxObligationRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toTaxObligationRow), (data) => tx.taxObligation.createMany({ data })),
  },
  taxRules: {
    upsert: async (tx, e) => void (await tx.taxRule.upsert(byId(M.toTaxRuleRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toTaxRuleRow), (data) => tx.taxRule.createMany({ data })),
  },
  taxWorkpapers: {
    upsert: async (tx, e) => void (await tx.taxWorkpaper.upsert(byId(M.toTaxWorkpaperRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toTaxWorkpaperRow), (data) => tx.taxWorkpaper.createMany({ data })),
  },
  fixedAssets: {
    upsert: async (tx, e) => void (await tx.fixedAsset.upsert(byId(M.toFixedAssetRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toFixedAssetRow), (data) => tx.fixedAsset.createMany({ data })),
  },
  documents: {
    upsert: async (tx, e) => void (await tx.document.upsert(byId(M.toDocumentRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toDocumentRow), (data) => tx.document.createMany({ data })),
  },
  budgets: {
    upsert: async (tx, e) => void (await tx.budget.upsert(byId(M.toBudgetRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toBudgetRow), (data) => tx.budget.createMany({ data })),
  },
  forecasts: {
    upsert: async (tx, e) => void (await tx.forecast.upsert(byId(M.toForecastRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toForecastRow), (data) => tx.forecast.createMany({ data })),
  },
  scenarios: {
    upsert: async (tx, e) => void (await tx.scenario.upsert(byId(M.toScenarioRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toScenarioRow), (data) => tx.scenario.createMany({ data })),
  },
  approvals: {
    upsert: async (tx, e) => void (await tx.approvalRequest.upsert(byId(M.toApprovalRequestRow(e)))),
    insertMany: (tx, es) =>
      chunked(es.map(M.toApprovalRequestRow), (data) => tx.approvalRequest.createMany({ data })),
  },
  agentActions: {
    upsert: async (tx, e) => void (await tx.agentAction.upsert(byId(M.toAgentActionRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toAgentActionRow), (data) => tx.agentAction.createMany({ data })),
  },
  auditEvents: {
    upsert: async () => {
      throw new Error("Audit events are append-only; use appendAudit()");
    },
    // Never truncated; duplicates (already-retained history) are skipped on reseed.
    insertMany: (tx, es) =>
      chunked(es.map(M.toAuditEventRow), (data) => tx.auditEvent.createMany({ data, skipDuplicates: true })),
  },
  policies: {
    upsert: async (tx, e) => void (await tx.policy.upsert(byId(M.toPolicyRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toPolicyRow), (data) => tx.policy.createMany({ data })),
  },
  knowledgeSources: {
    upsert: async (tx, e) => void (await tx.knowledgeSource.upsert(byId(M.toKnowledgeSourceRow(e)))),
    insertMany: (tx, es) =>
      chunked(es.map(M.toKnowledgeSourceRow), (data) => tx.knowledgeSource.createMany({ data })),
  },
  professionalGuidance: {
    upsert: async (tx, e) => void (await tx.professionalGuidance.upsert(byId(M.toProfessionalGuidanceRow(e)))),
    insertMany: (tx, es) =>
      chunked(es.map(M.toProfessionalGuidanceRow), (data) => tx.professionalGuidance.createMany({ data })),
  },
  configFields: {
    upsert: async (tx, e) => {
      const row = M.toConfigFieldRow(e);
      await tx.configField.upsert({ where: { section_key: M.configFieldRowId(row) }, create: row, update: row });
    },
    insertMany: (tx, es) => chunked(es.map(M.toConfigFieldRow), (data) => tx.configField.createMany({ data })),
  },
  evaluations: {
    upsert: async (tx, e) => void (await tx.evaluationRecord.upsert(byId(M.toEvaluationRecordRow(e)))),
    insertMany: (tx, es) =>
      chunked(es.map(M.toEvaluationRecordRow), (data) => tx.evaluationRecord.createMany({ data })),
  },
  competencyScores: {
    upsert: async (tx, e) => {
      const row = M.toCompetencyScoreRow(e);
      await tx.competencyScore.upsert({ where: { capabilityKey: row.capabilityKey }, create: row, update: row });
    },
    insertMany: (tx, es) =>
      chunked(es.map(M.toCompetencyScoreRow), (data) => tx.competencyScore.createMany({ data })),
  },
  calculations: {
    upsert: async (tx, e) => void (await tx.calculation.upsert(byId(M.toCalculationRow(e)))),
    insertMany: (tx, es) => chunked(es.map(M.toCalculationRow), (data) => tx.calculation.createMany({ data })),
  },
};

function byId<R extends { id: string }>(row: R): { where: { id: string }; create: R; update: R } {
  return { where: { id: row.id }, create: row, update: row };
}

/** Dependency order for bulk insert (FK parents first). Audit events go last and are never truncated. */
const INSERT_ORDER: CollectionName[] = [
  "accounts",
  "periods",
  "journalEntries",
  "bankAccounts",
  "cards",
  "transactions",
  "vendors",
  "customers",
  "invoices",
  "bills",
  "payments",
  "workers",
  "payrollRuns",
  "payrollLiabilities",
  "knowledgeSources",
  "taxRules",
  "taxObligations",
  "taxWorkpapers",
  "fixedAssets",
  "documents",
  "budgets",
  "forecasts",
  "scenarios",
  "policies",
  "professionalGuidance",
  "configFields",
  "approvals",
  "agentActions",
  "calculations",
  "evaluations",
  "competencyScores",
  "auditEvents",
];

/** Tables cleared by reset(). audit_events (immutable), users and sessions (auth) are retained. */
const RESET_TABLES = [
  "company_profiles",
  "config_fields",
  "journal_lines",
  "journal_entries",
  "periods",
  "accounts",
  "bank_accounts",
  "cards",
  "transactions",
  "vendors",
  "customers",
  "invoice_lines",
  "invoices",
  "bills",
  "payments",
  "workers",
  "payroll_runs",
  "payroll_liabilities",
  "tax_obligations",
  "tax_rules",
  "tax_workpapers",
  "fixed_assets",
  "documents",
  "budgets",
  "forecasts",
  "scenarios",
  "approval_requests",
  "agent_actions",
  "policies",
  "knowledge_sources",
  "professional_guidance",
  "evaluation_records",
  "competency_scores",
  "calculations",
];

/** Identity of an entity inside its collection (most have `id`; config fields and scores do not). */
function entityKey(collection: CollectionName, entity: unknown): string {
  const e = entity as Record<string, unknown>;
  if (collection === "configFields") return `${String(e.section)}::${String(e.key)}`;
  if (collection === "competencyScores") return String(e.capabilityKey);
  return String(e.id);
}

/**
 * PostgreSQL-backed DataStore (Prisma). Mirrors MemoryStore semantics: `load()` returns one live
 * dataset object that engines mutate, `upsert*` persist individual entities, `appendAudit` is
 * insert-only, `reset` replaces everything except the audit trail.
 */
export class PrismaStore implements DataStore {
  readonly kind = "postgres" as const;
  private cache: CompanyDataset | null = null;
  private auditIds = new Set<string>();

  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  get client(): PrismaClient {
    return this.prisma;
  }

  async load(): Promise<CompanyDataset> {
    if (this.cache) return this.cache;
    const p = this.prisma;
    const profileRow = await p.companyProfile.findFirst({ orderBy: { createdAt: "asc" } });
    if (!profileRow) {
      throw new Error("No company profile in the database. Run `npm run db:seed` (or store.reset(dataset)) first.");
    }
    const [
      accounts,
      periods,
      journalEntries,
      bankAccounts,
      cards,
      transactions,
      vendors,
      customers,
      invoices,
      bills,
      payments,
      workers,
      payrollRuns,
      payrollLiabilities,
      taxObligations,
      taxRules,
    ] = await Promise.all([
      p.account.findMany({ orderBy: { code: "asc" } }),
      p.period.findMany({ orderBy: { id: "asc" } }),
      p.journalEntry.findMany({ include: { lines: true }, orderBy: [{ entryNumber: "asc" }, { id: "asc" }] }),
      p.bankAccount.findMany({ orderBy: { id: "asc" } }),
      p.card.findMany({ orderBy: { id: "asc" } }),
      p.transaction.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }] }),
      p.vendor.findMany({ orderBy: { id: "asc" } }),
      p.customer.findMany({ orderBy: { id: "asc" } }),
      p.invoice.findMany({ include: { lines: true }, orderBy: [{ issueDate: "asc" }, { id: "asc" }] }),
      p.bill.findMany({ orderBy: [{ billDate: "asc" }, { id: "asc" }] }),
      p.payment.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }] }),
      p.worker.findMany({ orderBy: { id: "asc" } }),
      p.payrollRun.findMany({ orderBy: [{ payDate: "asc" }, { id: "asc" }] }),
      p.payrollLiability.findMany({ orderBy: [{ accruedDate: "asc" }, { id: "asc" }] }),
      p.taxObligation.findMany({ orderBy: { id: "asc" } }),
      p.taxRule.findMany({ orderBy: { id: "asc" } }),
    ]);
    const [
      taxWorkpapers,
      fixedAssets,
      documents,
      budgets,
      forecasts,
      scenarios,
      approvals,
      agentActions,
      auditEvents,
      policies,
      knowledgeSources,
      professionalGuidance,
      configFields,
      evaluations,
      competencyScores,
      calculations,
    ] = await Promise.all([
      p.taxWorkpaper.findMany({ orderBy: { id: "asc" } }),
      p.fixedAsset.findMany({ orderBy: { id: "asc" } }),
      p.document.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }] }),
      p.budget.findMany({ orderBy: { id: "asc" } }),
      p.forecast.findMany({ orderBy: { id: "asc" } }),
      p.scenario.findMany({ orderBy: { id: "asc" } }),
      p.approvalRequest.findMany({ orderBy: [{ requestedAt: "asc" }, { id: "asc" }] }),
      p.agentAction.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      p.auditEvent.findMany({ orderBy: { seq: "asc" } }),
      p.policy.findMany({ orderBy: { id: "asc" } }),
      p.knowledgeSource.findMany({ orderBy: { id: "asc" } }),
      p.professionalGuidance.findMany({ orderBy: { id: "asc" } }),
      p.configField.findMany({ orderBy: [{ section: "asc" }, { key: "asc" }] }),
      p.evaluationRecord.findMany({ orderBy: [{ ranAt: "asc" }, { id: "asc" }] }),
      p.competencyScore.findMany({ orderBy: { capabilityKey: "asc" } }),
      p.calculation.findMany({ orderBy: { id: "asc" } }),
    ]);

    const dataset: CompanyDataset = {
      profile: M.fromCompanyProfileRow(profileRow),
      accounts: accounts.map(M.fromAccountRow),
      periods: periods.map(M.fromPeriodRow),
      journalEntries: journalEntries.map(M.fromJournalEntryRow),
      bankAccounts: bankAccounts.map(M.fromBankAccountRow),
      cards: cards.map(M.fromCardRow),
      transactions: transactions.map(M.fromTransactionRow),
      vendors: vendors.map(M.fromVendorRow),
      customers: customers.map(M.fromCustomerRow),
      invoices: invoices.map(M.fromInvoiceRow),
      bills: bills.map(M.fromBillRow),
      payments: payments.map(M.fromPaymentRow),
      workers: workers.map(M.fromWorkerRow),
      payrollRuns: payrollRuns.map(M.fromPayrollRunRow),
      payrollLiabilities: payrollLiabilities.map(M.fromPayrollLiabilityRow),
      taxObligations: taxObligations.map(M.fromTaxObligationRow),
      taxRules: taxRules.map(M.fromTaxRuleRow),
      taxWorkpapers: taxWorkpapers.map(M.fromTaxWorkpaperRow),
      fixedAssets: fixedAssets.map(M.fromFixedAssetRow),
      documents: documents.map(M.fromDocumentRow),
      budgets: budgets.map(M.fromBudgetRow),
      forecasts: forecasts.map(M.fromForecastRow),
      scenarios: scenarios.map(M.fromScenarioRow),
      approvals: approvals.map(M.fromApprovalRequestRow),
      agentActions: agentActions.map(M.fromAgentActionRow),
      auditEvents: auditEvents.map(M.fromAuditEventRow),
      policies: policies.map(M.fromPolicyRow),
      knowledgeSources: knowledgeSources.map(M.fromKnowledgeSourceRow),
      professionalGuidance: professionalGuidance.map(M.fromProfessionalGuidanceRow),
      configFields: configFields.map(M.fromConfigFieldRow),
      evaluations: evaluations.map(M.fromEvaluationRecordRow),
      competencyScores: competencyScores.map(M.fromCompetencyScoreRow),
      calculations: calculations.map(M.fromCalculationRow),
    };
    this.auditIds = new Set(dataset.auditEvents.map((e) => e.id));
    this.cache = dataset;
    return dataset;
  }

  async upsert<K extends CollectionName>(collection: K, entity: Entity<K>): Promise<void> {
    await this.upsertMany(collection, [entity]);
  }

  async upsertMany<K extends CollectionName>(collection: K, entities: Entity<K>[]): Promise<void> {
    if (collection === "auditEvents") throw new Error("Audit events are append-only; use appendAudit()");
    if (entities.length === 0) return;
    const ops = OPS[collection] as CollectionOps<K>;
    await this.prisma.$transaction(
      async (tx) => {
        for (const e of entities) await ops.upsert(tx, e);
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
    if (this.cache) {
      const arr = this.cache[collection] as Entity<K>[];
      for (const e of entities) {
        const key = entityKey(collection, e);
        const idx = arr.findIndex((x) => entityKey(collection, x) === key);
        if (idx >= 0) arr[idx] = e;
        else arr.push(e);
      }
    }
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    if (this.auditIds.has(event.id)) throw new Error(`Audit event ${event.id} already exists (immutable log)`);
    try {
      await this.prisma.auditEvent.create({ data: M.toAuditEventRow(event) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = (err.meta?.target as string[] | undefined)?.join(",") ?? "unique key";
        throw new Error(`Audit event ${event.id} conflicts with the immutable log on ${target}`);
      }
      throw err;
    }
    this.auditIds.add(event.id);
    this.cache?.auditEvents.push(Object.freeze({ ...event }));
  }

  async reset(dataset: CompanyDataset): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`TRUNCATE TABLE ${RESET_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
        await tx.companyProfile.create({ data: M.toCompanyProfileRow(dataset.profile) });
        for (const name of INSERT_ORDER) {
          const ops = OPS[name] as CollectionOps<typeof name>;
          const entities = dataset[name] as Entity<typeof name>[];
          if (entities.length) await ops.insertMany(tx, entities);
        }
      },
      { timeout: 600_000, maxWait: 60_000 },
    );
    // Retain the full audit trail in the live dataset (events not present in the new dataset).
    const known = new Set(dataset.auditEvents.map((e) => e.id));
    const allIds = await this.prisma.auditEvent.findMany({ select: { id: true }, orderBy: { seq: "asc" } });
    const missing = allIds.map((r) => r.id).filter((id) => !known.has(id));
    await chunked(missing, async (ids) => {
      const rows = await this.prisma.auditEvent.findMany({ where: { id: { in: ids } }, orderBy: { seq: "asc" } });
      for (const row of rows) dataset.auditEvents.push(M.fromAuditEventRow(row));
    });
    this.auditIds = new Set(dataset.auditEvents.map((e) => e.id));
    this.cache = dataset;
  }

  /** Writes are already durable; nothing is buffered. */
  async flush(): Promise<void> {}

  /** Drop the in-memory dataset so the next load() re-reads the database. */
  invalidate(): void {
    this.cache = null;
  }
}
