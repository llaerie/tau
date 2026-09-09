import { describe, expect, it } from "vitest";
import type { Document, Policy, Transaction } from "@/lib/core/types";
import { emptyDataset } from "@/lib/core/types";
import { syntheticCompanyProfile } from "@/lib/knowledge/synthetic-profile";
import { POLICY_KEYS, defaultPolicies } from "@/lib/knowledge/policies";
import { classifyDocument } from "@/lib/documents/classifier";
import { retentionFor } from "@/lib/documents/retention";
import { WORKER_TAX_DOC_MESSAGE, missingDocumentAlerts } from "@/lib/documents/missing-documents";
import { AUTO_LINK_THRESHOLD, applyAutoLinks, matchReceiptsToTransactions, scoreLink } from "@/lib/documents/linking";

const doc = (id: string, kind: Document["kind"], date: string, extra: Partial<Document> = {}): Document => ({
  id, kind, title: `${kind} ${id}`, date, linkedTransactionIds: [], linkedJournalEntryIds: [], storagePath: `synthetic://${id}`, mimeType: "application/pdf",
  classificationConfidence: 0.9, retention: { policyKey: "document_retention", retainUntil: null }, isSynthetic: true, tags: [], uploadedAt: `${date}T00:00:00.000Z`, ...extra,
});
const tx = (id: string, date: string, amount: string, descriptionRaw: string, extra: Partial<Transaction> = {}): Transaction => ({
  id, sourceKind: "BANK", sourceAccountId: "b1", externalId: id, date, postedDate: date, amount, currency: "USD", descriptionRaw,
  category: { accountId: null, status: "UNCATEGORIZED", confidence: 0 }, documentIds: [], flags: [], importBatchId: "batch1", ...extra,
});

describe("document classifier", () => {
  it("classifies by title / extracted fields with confidence", () => {
    const cases: [string, Document["kind"]][] = [
      ["Form W-9 - Jane Contractor", "W9"],
      ["W-8BEN Li Wei", "W8"],
      ["2025 Form 1120-S", "TAX_RETURN"],
      ["IRS Notice CP2000", "TAX_NOTICE"],
      ["Articles of Organization", "ENTITY_DOCUMENT"],
      ["Payroll register March 2026", "PAYROLL_REPORT"],
      ["Checking account statement 2026-03", "BANK_STATEMENT"],
      ["Visa card statement March", "CARD_STATEMENT"],
      ["Certificate of Liability Insurance", "INSURANCE"],
      ["CPA memo re meals", "CPA_CORRESPONDENCE"],
      ["Master Services Agreement - Harborline", "CONTRACT"],
      ["Receipt - Office Depot", "RECEIPT"],
      ["Bill from CloudHost", "VENDOR_BILL"],
      ["random scan.pdf", "OTHER"],
    ];
    for (const [title, kind] of cases) expect(classifyDocument({ title }).kind, title).toBe(kind);
    expect(classifyDocument({ title: "random scan.pdf" }).confidence).toBe(0.2);
    expect(classifyDocument({ title: "Form W-9 - Jane" }).confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("disambiguates invoices by direction", () => {
    expect(classifyDocument({ title: "Invoice #1042", extracted: { direction: "OUTBOUND" } }).kind).toBe("CUSTOMER_INVOICE");
    expect(classifyDocument({ title: "Invoice #77", extracted: { vendorId: "v1" } }).kind).toBe("VENDOR_BILL");
    const ambiguous = classifyDocument({ title: "Invoice #5" });
    expect(ambiguous.kind).toBe("VENDOR_BILL");
    expect(ambiguous.confidence).toBeLessThanOrEqual(0.5);
  });

  it("never returns confidence 1.0 and lowers it on conflicts", () => {
    const r = classifyDocument({ title: "Insurance agreement contract receipt" });
    expect(r.confidence).toBeLessThan(0.85);
    expect(r.matchedRules.length).toBeGreaterThan(1);
  });
});

describe("retention", () => {
  const policies = defaultPolicies();

  it("returns null retainUntil while the policy is unconfirmed (default state)", () => {
    for (const kind of ["RECEIPT", "BANK_STATEMENT", "TAX_RETURN", "PAYROLL_REPORT", "OTHER"] as const) {
      const r = retentionFor(kind, policies, "2026-03-01");
      expect(r.retainUntil, kind).toBeNull();
      expect(r.basis).toBe("UNCONFIRMED");
    }
    expect(retentionFor("TAX_RETURN", policies).permanent).toBe(true);
    expect(retentionFor("RECEIPT", policies).years).toBe(7);
  });

  it("computes retainUntil only when the rule is CONFIRMED on an ACTIVE policy", () => {
    const base = policies.find((p) => p.key === POLICY_KEYS.DOCUMENT_RETENTION)!;
    const confirmed: Policy = { ...base, status: "ACTIVE", approvedBy: "CPA:1", parameters: { ...base.parameters, kinds: { ...(base.parameters!.kinds as object), RECEIPT: { years: 7, permanent: false, status: "CONFIRMED" }, TAX_RETURN: { years: null, permanent: true, status: "CONFIRMED" } } } };
    const others = policies.filter((p) => p.key !== POLICY_KEYS.DOCUMENT_RETENTION);
    expect(retentionFor("RECEIPT", [...others, confirmed], "2026-03-01")).toMatchObject({ retainUntil: "2033-03-01", basis: "CONFIRMED" });
    expect(retentionFor("TAX_RETURN", [...others, confirmed], "2026-03-01")).toMatchObject({ retainUntil: null, permanent: true, basis: "CONFIRMED" });
    expect(retentionFor("BANK_STATEMENT", [...others, confirmed], "2026-03-01").retainUntil).toBeNull();
    expect(retentionFor("RECEIPT", others).basis).toBe("NO_POLICY");
  });
});

describe("missing document alerts", () => {
  function dataset() {
    const ds = emptyDataset(syntheticCompanyProfile());
    ds.bankAccounts.push({ id: "b1", name: "Checking", institution: "Synthetic Bank", accountType: "CHECKING", last4: "1001", currency: "USD", glAccountId: "acct_1000", isSynthetic: true });
    ds.periods.push({ id: "2026-01", year: 2026, month: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "LOCKED" }, { id: "2026-02", year: 2026, month: 2, startDate: "2026-02-01", endDate: "2026-02-28", status: "OPEN" });
    ds.transactions.push(tx("t_big", "2026-01-10", "-250.00", "OFFICE DEPOT"), tx("t_small", "2026-01-11", "-20.00", "COFFEE"), tx("t_in", "2026-01-12", "30000.00", "HARBORLINE ACH"), tx("t_linked", "2026-01-13", "-500.00", "CLOUDHOST", { documentIds: ["r1"] }), tx("t_xfer", "2026-01-14", "-1000.00", "TRANSFER TO SAVINGS", { flags: ["TRANSFER"] }));
    ds.documents.push(doc("r1", "RECEIPT", "2026-01-13", { amount: "500.00" }), doc("bs1", "BANK_STATEMENT", "2026-01-31"));
    ds.bills.push({ id: "bill1", vendorId: "v1", number: "B-1", receivedDate: "2026-01-05", billDate: "2026-01-05", dueDate: "2026-02-04", currency: "USD", total: "900.00", amountPaid: "0.0000", status: "RECEIVED", expenseAccountId: "acct_7000", description: "hosting", paymentIds: [] });
    ds.workers.push(
      { id: "w_owner", displayName: "Owner", roleTitle: "CEO", country: "US", workerType: "EMPLOYEE", classificationStatus: "CONFIRMED", compensation: { type: "SALARY", amount: "3000.00", currency: "USD", period: "MONTHLY", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED" }, startDate: "2024-01-15", isOwner: true, relatedParty: true, documentIds: [], isSynthetic: true },
      { id: "w_cn", displayName: "Li Wei", roleTitle: "Engineer", country: "CN", workerType: "UNRESOLVED", classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW", compensation: { type: "CONTRACT", amount: "1500.00", currency: "USD", period: "MONTHLY", basis: "UNKNOWN", status: "UNCONFIRMED" }, startDate: "2025-06-01", isOwner: false, relatedParty: false, documentIds: [], isSynthetic: true },
      { id: "w_us_c", displayName: "Jane", roleTitle: "Designer", country: "US", workerType: "CONTRACTOR", classificationStatus: "CONFIRMED", compensation: { type: "CONTRACT", amount: "1000.00", currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "CONFIRMED" }, startDate: "2025-06-01", isOwner: false, relatedParty: false, documentIds: ["w9_jane"], isSynthetic: true },
    );
    ds.documents.push(doc("w9_jane", "W9", "2025-06-01", { workerId: "w_us_c" }));
    ds.customers.push({ id: "c1", name: "Harborline Holdings LLC", paymentTermsDays: 15, country: "US", relatedParty: true, active: true }, { id: "c2", name: "One-off Co", paymentTermsDays: 30, country: "US", relatedParty: false, active: true });
    const inv = (id: string, customerId: string) => ({ id, number: id, customerId, issueDate: "2026-01-01", dueDate: "2026-01-16", currency: "USD", total: "30000.00", amountPaid: "0.0000", status: "SENT" as const, lines: [], paymentIds: [] });
    ds.invoices.push(inv("i1", "c1"), inv("i2", "c1"), inv("i3", "c2"));
    return ds;
  }

  it("raises the expected alerts with a confirmed threshold", () => {
    const alerts = missingDocumentAlerts(dataset(), { receiptThreshold: "75.00" });
    const kinds = alerts.map((a) => `${a.kind}:${a.targetId}`);
    expect(kinds).toContain("MISSING_RECEIPT:t_big");
    expect(kinds).not.toContain("MISSING_RECEIPT:t_small");
    expect(kinds).not.toContain("MISSING_RECEIPT:t_in");
    expect(kinds).not.toContain("MISSING_RECEIPT:t_linked");
    expect(kinds).not.toContain("MISSING_RECEIPT:t_xfer");
    expect(kinds).toContain("BILL_WITHOUT_DOCUMENT:bill1");
    expect(kinds).toContain("WORKER_TAX_DOC_UNKNOWN:w_cn");
    expect(kinds).not.toContain("WORKER_TAX_DOC_UNKNOWN:w_us_c");
    expect(kinds).not.toContain("WORKER_TAX_DOC_UNKNOWN:w_owner");
    expect(alerts.find((a) => a.targetId === "w_cn")!.message).toContain(WORKER_TAX_DOC_MESSAGE);
    expect(alerts.find((a) => a.targetId === "w_cn")!.severity).toBe("HIGH");
    expect(kinds).not.toContain("BANK_STATEMENT_MISSING:b1"); // Jan statement present, Feb is OPEN
    expect(kinds).toContain("CONTRACT_MISSING:c1");
    expect(kinds).not.toContain("CONTRACT_MISSING:c2");
    expect(alerts.find((a) => a.kind === "CONTRACT_MISSING")!.severity).toBe("HIGH");
    expect(kinds).not.toContain("RECEIPT_THRESHOLD_UNCONFIRMED:expense_policy.receipt_required_above");
  });

  it("skips receipt checks and raises a config alert when the threshold is unconfirmed", () => {
    const alerts = missingDocumentAlerts(dataset(), { receiptThreshold: null });
    expect(alerts.some((a) => a.kind === "RECEIPT_THRESHOLD_UNCONFIRMED")).toBe(true);
    expect(alerts.some((a) => a.kind === "MISSING_RECEIPT")).toBe(false);
  });

  it("flags missing statements for closed months", () => {
    const ds = dataset();
    ds.documents = ds.documents.filter((d) => d.kind !== "BANK_STATEMENT");
    const alerts = missingDocumentAlerts(ds, { receiptThreshold: "75.00" });
    expect(alerts.find((a) => a.kind === "BANK_STATEMENT_MISSING")).toMatchObject({ targetId: "b1", severity: "HIGH" });
    expect(alerts.find((a) => a.kind === "BANK_STATEMENT_MISSING")!.message).toContain("2026-01");
  });
});

describe("receipt matching", () => {
  function dataset() {
    const ds = emptyDataset(syntheticCompanyProfile());
    ds.vendors.push({ id: "v1", name: "CloudHost Inc", normalizedNames: ["cloudhost"], isRecurring: true, country: "US", taxDocStatus: "NOT_REQUIRED", active: true, createdAt: "2026-01-01T00:00:00.000Z" });
    ds.transactions.push(
      tx("t1", "2026-03-05", "-120.00", "CLOUDHOST INC 03/05", { counterpartyRef: { type: "VENDOR", id: "v1" } }),
      tx("t2", "2026-03-07", "-120.00", "SOME OTHER MERCHANT"),
      tx("t3", "2026-03-20", "-45.10", "CAFE"),
      tx("t4", "2026-03-21", "-45.10", "CAFE"),
      tx("t5", "2026-03-01", "-999.00", "ONE MORE"),
    );
    ds.documents.push(
      doc("r_cloud", "RECEIPT", "2026-03-05", { amount: "120.00", currency: "USD", vendorId: "v1" }),
      doc("r_cafe", "RECEIPT", "2026-03-20", { amount: "45.10", currency: "USD" }),
      doc("r_far", "RECEIPT", "2026-03-10", { amount: "999.00", currency: "USD" }),
      doc("r_off", "RECEIPT", "2026-03-01", { amount: "999.50", currency: "USD" }),
    );
    return ds;
  }

  it("scores amount ± 0.01, date ± 3 days and vendor match; auto-link only at ≥ 0.8", () => {
    const ds = dataset();
    const links = matchReceiptsToTransactions(ds);
    const by = Object.fromEntries(links.map((l) => [l.documentId, l]));
    expect(by.r_cloud.transactionId).toBe("t1");
    expect(by.r_cloud.confidence).toBe(1);
    expect(by.r_cloud.autoLinkEligible).toBe(true);
    expect(by.r_cloud.reasons.join(" ")).toMatch(/vendor match/);
    // same amount, same date, no vendor: 0.7 -> not auto-linkable
    expect(by.r_cafe.transactionId).toBe("t3");
    expect(by.r_cafe.confidence).toBe(0.7);
    expect(by.r_cafe.autoLinkEligible).toBe(false);
    // 9 days apart -> no candidate; amount off by 0.50 -> no candidate
    expect(by.r_far).toBeUndefined();
    expect(by.r_off).toBeUndefined();
    // one-to-one: t1 used once
    expect(new Set(links.map((l) => l.transactionId)).size).toBe(links.length);
    expect(AUTO_LINK_THRESHOLD).toBe(0.8);
  });

  it("scoreLink respects tolerances exactly", () => {
    const ds = dataset();
    const d = doc("x", "RECEIPT", "2026-03-05", { amount: "120.01", currency: "USD", vendorId: "v1" });
    expect(scoreLink(d, ds.transactions[0], ds)!.confidence).toBe(1);
    expect(scoreLink(doc("y", "RECEIPT", "2026-03-05", { amount: "120.02", currency: "USD" }), ds.transactions[0], ds)).toBeNull();
    expect(scoreLink(doc("z", "RECEIPT", "2026-03-08", { amount: "120.00", currency: "USD", vendorId: "v1" }), ds.transactions[0], ds)!.confidence).toBe(0.9);
    expect(scoreLink(doc("w", "RECEIPT", "2026-03-09", { amount: "120.00", currency: "USD", vendorId: "v1" }), ds.transactions[0], ds)).toBeNull();
    expect(scoreLink(doc("c", "RECEIPT", "2026-03-05", { amount: "120.00", currency: "CNY" }), ds.transactions[0], ds)).toBeNull();
  });

  it("applyAutoLinks applies only eligible proposals and clears MISSING_RECEIPT", () => {
    const ds = dataset();
    ds.transactions[0].flags = ["MISSING_RECEIPT"];
    const links = matchReceiptsToTransactions(ds);
    const { documents, transactions, applied } = applyAutoLinks(ds, links);
    expect(applied.map((a) => a.documentId)).toEqual(["r_cloud"]);
    expect(documents.find((d) => d.id === "r_cloud")!.linkedTransactionIds).toEqual(["t1"]);
    expect(transactions.find((t) => t.id === "t1")!.documentIds).toEqual(["r_cloud"]);
    expect(transactions.find((t) => t.id === "t1")!.flags).toEqual([]);
    expect(documents.find((d) => d.id === "r_cafe")!.linkedTransactionIds).toEqual([]);
    // original dataset untouched
    expect(ds.documents.find((d) => d.id === "r_cloud")!.linkedTransactionIds).toEqual([]);
  });
});
