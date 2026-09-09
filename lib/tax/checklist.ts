/**
 * Tax document checklist by tax year: which documents the CPA needs, and which are present
 * in `dataset.documents`. Presence is a fact about the dataset; "required" is a default
 * expectation the CPA can adjust.
 */
import type { CompanyDataset, Document, DocumentKind } from "@/lib/core/types";
import { monthsBetween } from "@/lib/core/dates";

export interface ChecklistItem {
  key: string;
  label: string;
  kinds: DocumentKind[];
  required: boolean;
  present: boolean;
  documentIds: string[];
  /** e.g. months with no statement */
  missingDetail?: string[];
  note?: string;
}

export interface TaxDocumentChecklist {
  taxYear: number;
  items: ChecklistItem[];
  presentCount: number;
  missingRequiredCount: number;
}

const inYear = (d: Document, y: number) => d.date.startsWith(`${y}-`);
const hasTag = (d: Document, ...tags: string[]) => tags.some((t) => d.tags.includes(t) || d.title.toLowerCase().includes(t.replace(/_/g, " ")));

export function buildTaxDocumentChecklist(dataset: CompanyDataset, taxYear: number): TaxDocumentChecklist {
  const docs = dataset.documents;
  const months = monthsBetween(`${taxYear}-01`, `${taxYear}-12`);
  const items: ChecklistItem[] = [];
  const add = (key: string, label: string, kinds: DocumentKind[], matched: Document[], required = true, note?: string, missingDetail?: string[]) => {
    items.push({ key, label, kinds, required, present: matched.length > 0 && !(missingDetail && missingDetail.length), documentIds: matched.map((d) => d.id), missingDetail, note });
  };

  add("prior_returns", `Prior year tax returns (federal 1120-S and CA 100S for ${taxYear - 1})`, ["TAX_RETURN"], docs.filter((d) => d.kind === "TAX_RETURN" && inYear(d, taxYear - 1)), true, "Establish method, basis, depreciation history and carryforwards.");

  const bankMissing: string[] = [];
  for (const acct of dataset.bankAccounts) {
    for (const m of months) {
      if (!docs.some((d) => d.kind === "BANK_STATEMENT" && d.date.startsWith(m) && (d.extracted?.accountId === acct.id || d.tags.includes(`account:${acct.id}`) || dataset.bankAccounts.length === 1))) bankMissing.push(`${acct.name}:${m}`);
    }
  }
  add("bank_statements", `Bank statements for every account, every month of ${taxYear}`, ["BANK_STATEMENT"], docs.filter((d) => d.kind === "BANK_STATEMENT" && inYear(d, taxYear)), true, dataset.bankAccounts.length ? undefined : "Bank accounts are UNKNOWN; cannot determine which statements are needed.", bankMissing);

  const cardMissing: string[] = [];
  for (const card of dataset.cards) {
    for (const m of months) {
      if (!docs.some((d) => d.kind === "CARD_STATEMENT" && d.date.startsWith(m) && (d.extracted?.cardId === card.id || d.tags.includes(`card:${card.id}`) || dataset.cards.length === 1))) cardMissing.push(`${card.name}:${m}`);
    }
  }
  add("card_statements", `Card statements for every card, every month of ${taxYear}`, ["CARD_STATEMENT"], docs.filter((d) => d.kind === "CARD_STATEMENT" && inYear(d, taxYear)), dataset.cards.length > 0, dataset.cards.length ? undefined : "Cards are UNKNOWN.", cardMissing);

  add("payroll_reports", `Payroll reports / registers for ${taxYear} (quarterly and annual)`, ["PAYROLL_REPORT"], docs.filter((d) => d.kind === "PAYROLL_REPORT" && inYear(d, taxYear)), dataset.workers.some((w) => w.workerType === "EMPLOYEE"), "Needed to reconcile wages, withholding and employer taxes to filings.");

  add("1099s_issued", `Information returns issued to contractors for ${taxYear}`, ["OTHER"], docs.filter((d) => (inYear(d, taxYear) || inYear(d, taxYear + 1)) && hasTag(d, "1099_issued", "1099-nec issued", "1099 issued")), dataset.workers.some((w) => w.workerType === "CONTRACTOR" || w.workerType === "UNRESOLVED"), "Which payees require a form is confirmed with the CPA.");
  add("1099s_received", `Information returns received from customers for ${taxYear}`, ["OTHER"], docs.filter((d) => (inYear(d, taxYear) || inYear(d, taxYear + 1)) && hasTag(d, "1099_received", "1099 received")), false);

  const assetDocIds = new Set(dataset.fixedAssets.filter((a) => a.acquiredDate.startsWith(`${taxYear}-`)).map((a) => a.documentId).filter(Boolean));
  const assetsThisYear = dataset.fixedAssets.filter((a) => a.acquiredDate.startsWith(`${taxYear}-`));
  const assetDocs = docs.filter((d) => assetDocIds.has(d.id));
  add("fixed_asset_invoices", `Invoices for fixed assets acquired in ${taxYear}`, ["RECEIPT", "VENDOR_BILL"], assetDocs, assetsThisYear.length > 0, undefined, assetsThisYear.filter((a) => !a.documentId).map((a) => a.name));

  add("entity_documents", "Entity documents (articles, operating agreement, S election acceptance, Statement of Information)", ["ENTITY_DOCUMENT"], docs.filter((d) => d.kind === "ENTITY_DOCUMENT"), true);
  add("shareholder_basis", "Shareholder basis information (capital contributions, distributions, loans, prior basis schedule)", ["OTHER", "CPA_CORRESPONDENCE"], docs.filter((d) => hasTag(d, "basis", "shareholder_basis")), true, "Basis history comes from the CPA / prior returns; the system cannot derive it.");
  add("contractor_tax_forms", "Tax documentation for contractors (W-9 / W-8 as applicable)", ["W9", "W8"], docs.filter((d) => d.kind === "W9" || d.kind === "W8"), dataset.workers.some((w) => w.workerType !== "EMPLOYEE") || dataset.vendors.some((v) => v.taxDocStatus !== "NOT_REQUIRED"), "Which form applies per payee is not assumed; confirm with CPA.");
  add("tax_notices", `Tax notices received during ${taxYear}`, ["TAX_NOTICE"], docs.filter((d) => d.kind === "TAX_NOTICE" && inYear(d, taxYear)), false);
  add("insurance", "Insurance policies / declarations in force", ["INSURANCE"], docs.filter((d) => d.kind === "INSURANCE"), false);

  return {
    taxYear,
    items,
    presentCount: items.filter((i) => i.present).length,
    missingRequiredCount: items.filter((i) => i.required && !i.present).length,
  };
}
