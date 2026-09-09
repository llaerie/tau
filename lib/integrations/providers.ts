/**
 * Adapter interfaces for future live integrations. Phase One ships ONLY
 * "not connected" implementations. No live accounts are created and no
 * money moves. Selecting a provider in the setup wizard records an
 * UNCONFIRMED configuration choice; it never connects anything.
 */
import type { Bill, DecimalString, Document, ID, ISODate, Invoice, JournalEntry, PayrollRun, Transaction } from "@/lib/core/types";

export type ProviderStatus = "NOT_CONNECTED" | "CONFIGURED_NOT_CONNECTED" | "READ_ONLY" | "SHADOW" | "WHITELISTED_WRITES";

export interface ProviderInfo {
  key: string;
  vendor: string;
  kind: "ACCOUNTING" | "PAYROLL" | "BANK_DATA" | "DOCUMENT" | "INTERNATIONAL_WORKFORCE";
  status: ProviderStatus;
  /** Phase at which this adapter is allowed to write (see docs/PHASE_PLAN.md) */
  earliestWritePhase: 4 | 5;
  notes: string[];
}

export interface AccountingProvider {
  info(): ProviderInfo;
  /** Phase Two: read-only pull of historical entries. */
  pullJournalEntries(from: ISODate, to: ISODate): Promise<JournalEntry[]>;
  pullInvoices(from: ISODate, to: ISODate): Promise<Invoice[]>;
  pullBills(from: ISODate, to: ISODate): Promise<Bill[]>;
  /** Phase Four+: whitelisted, reversible writes only — never available in Phase One. */
  pushJournalEntry?(entry: JournalEntry, approvalId: ID): Promise<{ externalId: string }>;
}

export interface PayrollProvider {
  info(): ProviderInfo;
  pullPayrollRuns(from: ISODate, to: ISODate): Promise<PayrollRun[]>;
  /** Payroll execution always requires the external provider plus human authorization. Not implemented here. */
}

export interface BankDataProvider {
  info(): ProviderInfo;
  pullTransactions(accountRef: string, from: ISODate, to: ISODate): Promise<Transaction[]>;
  pullBalance(accountRef: string, asOf: ISODate): Promise<{ balance: DecimalString; asOf: ISODate; isLive: boolean }>;
}

export interface DocumentProvider {
  info(): ProviderInfo;
  list(prefix?: string): Promise<Document[]>;
  fetch(storagePath: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  store(doc: Document, bytes: Uint8Array): Promise<{ storagePath: string }>;
}

export interface ProviderOption {
  key: string;
  vendor: string;
  kind: ProviderInfo["kind"];
  description: string;
}

/** Options offered by the setup wizard. Listing an option creates nothing. */
export const PROVIDER_OPTIONS: ProviderOption[] = [
  { key: "internal", vendor: "Tau internal ledger", kind: "ACCOUNTING", description: "Built-in double-entry engine (Phase One default)." },
  { key: "quickbooks_online", vendor: "QuickBooks Online", kind: "ACCOUNTING", description: "Adapter to be implemented in Phase Two (read-only first)." },
  { key: "xero", vendor: "Xero", kind: "ACCOUNTING", description: "Adapter to be implemented in Phase Two (read-only first)." },
  { key: "gusto", vendor: "Gusto", kind: "PAYROLL", description: "U.S. payroll provider; execution stays with the provider + human authorization." },
  { key: "rippling", vendor: "Rippling", kind: "PAYROLL", description: "U.S. payroll provider; execution stays with the provider + human authorization." },
  { key: "adp", vendor: "ADP", kind: "PAYROLL", description: "U.S. payroll provider; execution stays with the provider + human authorization." },
  { key: "plaid", vendor: "Plaid", kind: "BANK_DATA", description: "Bank/card data aggregation (read-only)." },
  { key: "s3", vendor: "S3-compatible object storage", kind: "DOCUMENT", description: "Encrypted document storage." },
  { key: "google_drive", vendor: "Google Drive", kind: "DOCUMENT", description: "Document intake from an existing Drive folder." },
  { key: "international_eor", vendor: "Employer-of-record / global contractor platform", kind: "INTERNATIONAL_WORKFORCE", description: "To be chosen only after cross-border professional review of the China-based workers." },
];

const notConnected = (key: string, vendor: string, kind: ProviderInfo["kind"], earliestWritePhase: 4 | 5 = 4): ProviderInfo => ({
  key,
  vendor,
  kind,
  status: "NOT_CONNECTED",
  earliestWritePhase,
  notes: ["Phase One: no live connection exists. Synthetic data only."],
});

export class NotConnectedAccountingProvider implements AccountingProvider {
  constructor(private readonly key = "internal", private readonly vendor = "Tau internal ledger") {}
  info() {
    return notConnected(this.key, this.vendor, "ACCOUNTING");
  }
  async pullJournalEntries() {
    return [];
  }
  async pullInvoices() {
    return [];
  }
  async pullBills() {
    return [];
  }
}

export class NotConnectedPayrollProvider implements PayrollProvider {
  constructor(private readonly key = "none", private readonly vendor = "No payroll provider selected") {}
  info() {
    return notConnected(this.key, this.vendor, "PAYROLL", 5);
  }
  async pullPayrollRuns() {
    return [];
  }
}

export class NotConnectedBankDataProvider implements BankDataProvider {
  constructor(private readonly key = "none", private readonly vendor = "No bank data provider selected") {}
  info() {
    return notConnected(this.key, this.vendor, "BANK_DATA");
  }
  async pullTransactions() {
    return [];
  }
  async pullBalance(_accountRef: string, asOf: ISODate) {
    // Never fabricate a balance: the caller must treat isLive=false as "no data".
    return { balance: "0.0000", asOf, isLive: false };
  }
}

export class NotConnectedDocumentProvider implements DocumentProvider {
  constructor(private readonly key = "local", private readonly vendor = "Local synthetic document store") {}
  info() {
    return notConnected(this.key, this.vendor, "DOCUMENT");
  }
  async list() {
    return [];
  }
  async fetch() {
    return null;
  }
  async store(doc: Document) {
    return { storagePath: doc.storagePath };
  }
}

export interface ProviderSet {
  accounting: AccountingProvider;
  payroll: PayrollProvider;
  bank: BankDataProvider;
  documents: DocumentProvider;
}

export function phaseOneProviders(): ProviderSet {
  return {
    accounting: new NotConnectedAccountingProvider(),
    payroll: new NotConnectedPayrollProvider(),
    bank: new NotConnectedBankDataProvider(),
    documents: new NotConnectedDocumentProvider(),
  };
}

/** Config keys the setup wizard writes (values are UNCONFIRMED choices, never connections). */
export const PROVIDER_CONFIG_KEYS = {
  ACCOUNTING: "provider_accounting",
  PAYROLL: "provider_payroll",
  BANK_DATA: "provider_bank_data",
  DOCUMENT: "provider_documents",
  INTERNATIONAL: "provider_international_workforce",
} as const;
