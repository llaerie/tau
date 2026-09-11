/** Markdown rendering of a CPA package. */
import { fmtMoney } from "@/lib/core/money";
import { AI_ASSUMPTION_LABEL } from "./shared";
import type { CpaPackage } from "./cpa-package";

const m = (v: string | null | undefined) => (v === null || v === undefined ? "UNKNOWN" : fmtMoney(v));

export function renderCpaPackageMarkdown(p: CpaPackage): string {
  const L: string[] = [];
  L.push(`# CPA Package — ${p.companyName} — ${p.from} to ${p.to}`);
  if (p.isSyntheticData) L.push("", "> **SYNTHETIC DATA** — generated from the Phase One lab company. Nothing here is a real company record.");
  L.push("", "## Cover memo", "", p.coverMemo);

  L.push("", "## 1. Trial balance", "", "| Code | Account | Debit | Credit |", "|---|---|---:|---:|");
  for (const r of p.trialBalance.rows) L.push(`| ${r.code} | ${r.name} | ${m(r.debit)} | ${m(r.credit)} |`);
  L.push(`| | **Total** | **${m(p.trialBalance.totalDebits)}** | **${m(p.trialBalance.totalCredits)}** |`, "", `Balanced: ${p.trialBalance.balanced ? "yes" : "NO"}`);

  L.push("", `## 2. General ledger (${p.generalLedger.count} entries)`, "");
  for (const e of p.generalLedger.entries) {
    L.push(`- #${e.entryNumber} ${e.date} ${e.description} [${e.source}/${e.status}]`);
    for (const l of e.lines) L.push(`  - ${l.accountCode} ${l.accountName}: Dr ${m(l.debit)} / Cr ${m(l.credit)}${l.memo ? ` — ${l.memo}` : ""}`);
  }

  L.push("", "## 3. Income statement", "");
  for (const l of p.incomeStatement.lines) L.push(`${"  ".repeat(l.level)}${l.isTotal ? "**" : ""}${l.label}: ${m(l.amount)}${l.isTotal ? "**" : ""}`);
  L.push("", "## 4. Balance sheet", "");
  for (const l of p.balanceSheet.lines) L.push(`${"  ".repeat(l.level)}${l.isTotal ? "**" : ""}${l.label}: ${m(l.amount)}${l.isTotal ? "**" : ""}`);
  L.push("", `Balanced: ${p.balanceSheet.balanced ? "yes" : `NO (difference ${m(p.balanceSheet.difference)})`}`);
  L.push("", "## 5. Cash flow statement (indirect)", "", `- Net income: ${m(p.cashFlowStatement.netIncome)}`);
  for (const l of p.cashFlowStatement.operatingAdjustments) L.push(`  - ${l.label}: ${m(l.amount)}`);
  L.push(`- Operating: ${m(p.cashFlowStatement.operating)}`, `- Investing: ${m(p.cashFlowStatement.investing)}`, `- Financing: ${m(p.cashFlowStatement.financing)}`, `- Opening cash ${m(p.cashFlowStatement.openingCash)} → closing cash ${m(p.cashFlowStatement.closingCash)} (reconciled: ${p.cashFlowStatement.reconciled ? "yes" : "NO"})`);

  L.push("", "## 6. Bank and card reconciliations", "");
  for (const r of p.bankReconciliations) L.push(`- ${r.name} (${r.kind}): GL ${m(r.glBalance)} vs statement ${m(r.bankBalance)}, difference ${m(r.difference)} — ${r.reconciled ? "reconciled" : `NOT reconciled (${r.unmatchedTransactionIds.length} unmatched transactions, ${r.unmatchedJournalEntryIds.length} unmatched entries)`}`);

  L.push("", "## 7. Payroll reports", "");
  for (const r of p.payrollReports.runs) L.push(`- ${r.payDate} (${r.periodStart}..${r.periodEnd}) ${r.status}: gross ${m(r.totals.gross)}, employee taxes ${m(r.totals.employeeTaxes)}, employer taxes ${m(r.totals.employerTaxes)}, net ${m(r.totals.netPay)}, total cost ${m(r.totals.totalEmployerCost)}`);
  L.push("", "By quarter:");
  for (const q of p.payrollReports.byQuarter) L.push(`- ${q.quarter}: ${q.runCount} run(s); gross ${m(q.gross)}; employer taxes ${m(q.employerTaxes)}; total cost ${m(q.totalEmployerCost)}`);
  L.push(`- **Total**: gross ${m(p.payrollReports.totals.gross)}; net ${m(p.payrollReports.totals.netPay)}; total employer cost ${m(p.payrollReports.totals.totalEmployerCost)}`);
  if (p.payrollReports.liabilities.length) {
    L.push("", "Payroll liabilities accrued in range:");
    for (const l of p.payrollReports.liabilities) L.push(`- ${l.kind}: ${m(l.amount)} accrued ${l.accruedDate}, due ${l.dueDate ?? "UNKNOWN"}, ${l.status}`);
  }

  const s = p.shareholderSummary;
  L.push("", "## 8. Shareholder summary", "", `- Officer compensation (YTD): ${m(s.officerCompensation)}`, `- Distributions (YTD): ${m(s.distributions)}`, `- Due from shareholder: ${m(s.dueFromShareholder)}`, `- Due to shareholder: ${m(s.dueToShareholder)}`, `- Capital contributions (YTD): ${m(s.capitalContributions)}`, `- Owners: ${s.owners.map((o) => o.displayName).join(", ") || "none on record"}`, "", `> ${s.note}`);

  L.push("", "## 9. Fixed asset schedule", "");
  if (!p.fixedAssetSchedule.assets.length) L.push("- No fixed assets on the register.");
  for (const r of p.fixedAssetSchedule.assets) L.push(`- ${r.asset.name}: cost ${m(r.asset.cost)}, in service ${r.asset.inServiceDate}, ${r.asset.usefulLifeMonths} months straight-line; accumulated ${m(r.accumulatedThroughPeriod)}; NBV ${m(r.netBookValue)}; tax treatment ${r.asset.taxTreatmentStatus}`);
  L.push(`- **Totals**: cost ${m(p.fixedAssetSchedule.totalCost)}, accumulated ${m(p.fixedAssetSchedule.totalAccumulated)}`);

  const aging = (label: string, a: CpaPackage["arAging"]) => {
    L.push("", `## ${label}`, "", `Total ${m(a.total)}; overdue ${m(a.overdueTotal)}. Buckets: ${Object.entries(a.buckets).map(([k, v]) => `${k} ${m(v)}`).join(", ")}`);
    for (const r of a.rows) L.push(`- ${r.counterpartyName}: ${m(r.total)} (${r.itemCount} item(s))`);
  };
  aging("10. AR aging", p.arAging);
  aging("11. AP aging", p.apAging);

  L.push("", `## 12. Significant journal entries (${p.significantJournalEntries.length})`, "");
  for (const e of p.significantJournalEntries) L.push(`- #${e.entryNumber} ${e.date} ${e.description}: ${e.reasons.join("; ")}`);

  L.push("", "## 13. Tax workpapers", "");
  for (const w of p.taxWorkpapers) {
    L.push(`### ${w.title} (confidence ${w.confidence}, CPA review ${w.cpaReviewStatus})`, "", "FACTS:");
    for (const f of w.facts) L.push(`- ${f.label}: ${f.value === null || f.value === undefined ? "UNKNOWN" : String(f.value)}${f.sourceIds.length ? ` [${f.sourceIds.join(", ")}]` : " [NO SOURCE]"}`);
    L.push("", `CALCULATIONS: ${w.calculations.join(", ") || "none"}`, "", "ASSUMPTIONS:");
    for (const a of w.assumptions) L.push(`- ${a.key} [${a.status}]: ${a.description}`);
    L.push("", "PROFESSIONAL JUDGMENT:");
    for (const j of w.professionalJudgmentItems) L.push(`- ${j}`);
    L.push("");
  }

  L.push("", "## 14. Missing documents", "");
  for (const a of p.missingDocuments.alerts) L.push(`- [${a.severity}] ${a.message}`);
  L.push("", `Tax document checklist ${p.missingDocuments.checklist.taxYear}: ${p.missingDocuments.checklist.presentCount} present, ${p.missingDocuments.checklist.missingRequiredCount} required item(s) missing.`);
  for (const i of p.missingDocuments.checklist.items.filter((x) => x.required && !x.present)) L.push(`- MISSING: ${i.label}${i.missingDetail?.length ? ` (${i.missingDetail.slice(0, 6).join(", ")}${i.missingDetail.length > 6 ? ", …" : ""})` : ""}`);

  L.push("", `## 15. Unresolved accounting questions (${p.unresolvedAccountingQuestions.length})`, "");
  for (const q of p.unresolvedAccountingQuestions) L.push(`- [${q.urgency}] (${q.source}) ${q.question}${q.context ? ` — ${q.context}` : ""}`);

  L.push("", `## 16. Transactions requiring tax guidance (${p.transactionsRequiringTaxGuidance.length})`, "");
  for (const t of p.transactionsRequiringTaxGuidance) L.push(`- ${t.date} ${t.description} ${m(t.amount)} [${t.accountCode ?? "uncategorized"}]: ${t.reasons.join("; ")}`);

  L.push("", `## 17. International worker questions (${p.internationalWorkerQuestions.length})`, "");
  for (const w of p.internationalWorkerQuestions) L.push(`- ${w.displayName} (${w.country}, ${w.workerType}): ${w.reviewStatus}; open facts: ${w.openFields.join(", ") || "none listed"}`);

  L.push("", `## 18. ${AI_ASSUMPTION_LABEL} (${p.agentGeneratedAssumptions.length})`, "");
  for (const a of p.agentGeneratedAssumptions) L.push(`- **${a.label}** ${a.key} [${a.status}]: ${a.description} (value ${a.value === null || a.value === undefined ? "UNKNOWN" : JSON.stringify(a.value)}; calc ${a.calcId})`);

  L.push("", `_Package ${p.id}, generated ${p.generatedAt}; ${p.calcIds.length} calculation(s)._`);
  return L.join("\n");
}
