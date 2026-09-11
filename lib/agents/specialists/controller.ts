/** Controller agent: ledger, journal entries, statements, close cycle. */
import { monthEnd } from "@/lib/core/dates";
import { extractEntities, monthRange, yearRange, type RouteRule } from "../intent";
import { accountingCloseTools, accrualTool, bankReconciliationTool, closePeriodTool, correctingEntryTool, depreciationScheduleTool, modifyClosedPeriodTool, prepaidAmortizationTool } from "../tools/accounting-close-tools";
import { draftJournalEntryTool, explainStatementTool, financialStatementsTool, postJournalEntryTool, trialBalanceTool } from "../tools/accounting-tools";
import { Specialist, guessExpenseCode, previousMonth } from "./shared";

function range(message: string, asOf: string) {
  const e = extractEntities(message, asOf);
  if (e.months.length) return monthRange(e.months[0]);
  if (/\b(ytd|year to date)\b/i.test(message)) return { from: `${asOf.slice(0, 4)}-01-01`, to: asOf };
  if (e.years.length) return yearRange(e.years[0]);
  if (e.dates.length >= 2) return { from: e.dates[0], to: e.dates[1] };
  if (/\bthis month\b/i.test(message)) return monthRange(asOf.slice(0, 7));
  return monthRange(previousMonth(asOf));
}

function eventType(message: string): string | undefined {
  const m = message.toLowerCase();
  if (/equipment|laptop|computer|macbook|capitali[sz]e/.test(m)) return "EQUIPMENT_PURCHASE";
  if (/distribution|owner draw/.test(m)) return "SHAREHOLDER_DISTRIBUTION";
  if (/capital contribution|owner (put|invested)/.test(m)) return "OWNER_CAPITAL_CONTRIBUTION";
  if (/prepaid|paid .* in advance|annual (plan|subscription) up ?front/.test(m)) return "PREPAID_PURCHASE";
  if (/depreciat/.test(m)) return "DEPRECIATION";
  if (/accru/.test(m)) return "ACCRUE_EXPENSE";
  if (/pay(ing|ment of)? (the |a )?bill|paid (the |a )?bill|bill payment/.test(m)) return "PAY_BILL";
  if (/received (a |the )?bill|vendor bill|bill (from|received)/.test(m)) return "BILL_RECEIVED";
  if (/collected|customer paid|payment received|received payment/.test(m)) return "COLLECT_RECEIVABLE";
  if (/invoice|revenue on credit|billed (the |a )?client|billed (the |a )?customer/.test(m)) return "REVENUE_ON_CREDIT";
  if (/cash (sale|revenue)|revenue received in cash/.test(m)) return "CASH_REVENUE";
  if (/bank fee|service charge/.test(m)) return "BANK_FEE";
  if (/refund/.test(m)) return "REFUND_RECEIVED";
  if (/card payment|paid (the |off the )?(credit )?card/.test(m)) return "CARD_PAYMENT";
  if (/loan (proceeds|received|from the bank)/.test(m)) return "LOAN_PROCEEDS";
  if (/loan payment|repay/.test(m)) return "LOAN_PAYMENT";
  if (/interest income|interest earned/.test(m)) return "INTEREST_INCOME";
  if (/transfer/.test(m)) return "TRANSFER_BETWEEN_ACCOUNTS";
  if (/deferred revenue|prepayment from (a )?customer|customer prepaid/.test(m)) return "DEFERRED_REVENUE_RECEIPT";
  if (/on (the )?(company |business )?(credit )?card|card charge|charged to the card/.test(m)) return "EXPENSE_ON_CARD";
  if (/from (the )?(checking|bank|operating)|paid by ach|bank debit|paid from/.test(m)) return "EXPENSE_FROM_BANK";
  if (/expense|paid|bought|purchase/.test(m)) return "EXPENSE_FROM_BANK";
  return undefined;
}

const rules: RouteRule[] = [
  { kind: "accounting.modify_closed_period", weight: 3, any: [/\b(change|modify|edit|reopen|unlock|adjust|alter)\b[^.?!]{0,40}\b(closed|locked)\s+(period|month|quarter|books)/i, /\b(closed|locked)\s+(period|month)\b[^.?!]{0,40}\b(change|modify|edit|reopen|unlock)/i], params: (m, e, asOf) => ({ periodId: e.months[0] ?? previousMonth(asOf), description: m }) },
  { kind: "accounting.close_period", weight: 2.5, any: [/\bclose (the )?(month|period|books)\b/i, /\bmonth[- ]end close\b/i, /\brun (the )?close\b/i, /\block (the )?(period|month)\b/i], params: (m, e, _asOf) => ({ periodId: e.months[0], lock: /\block\b/i.test(m) }) },
  { kind: "accounting.correcting_entry", weight: 2.5, any: [/\bcorrect(ing|ion)?\s+(entry|the entry|journal|je)\b/i, /\bfix (the |that )?(posted )?entry\b/i, /\breverse (the |that |posted )?entry\b/i], params: (m, e, _asOf) => ({ originalEntryId: e.ids.find((i) => i.startsWith("je_")) ?? "", reason: m }) },
  { kind: "accounting.post_journal_entry", weight: 2.5, all: [/\bpost\b/i], any: [/\bje_[\w-]+/i, /\b(the |this |draft )?(journal )?entry\b/i], none: [/\bdraft\b.*\bentry\b(?!.*\bpost\b)/i], params: (_m, e, _asOf) => ({ entryId: e.ids.find((i) => i.startsWith("je_")) ?? "" }) },
  { kind: "accounting.bank_reconciliation", weight: 2.5, all: [/\breconcil/i], any: [/\b(bank|checking|savings|card|account)\b/i], none: [/\bpayroll\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0], accountId: e.ids.find((i) => i.startsWith("bank_") || i.startsWith("card_")) }) },
  { kind: "accounting.depreciation_schedule", weight: 2.5, any: [/\bdepreciat/i], none: [/\bjournal entry\b/i], params: (m, e, _asOf) => { const months = e.durations.find((d) => d.unit === "MONTH")?.value ?? (e.durations.find((d) => d.unit === "YEAR") ? e.durations.find((d) => d.unit === "YEAR")!.value * 12 : undefined); return { cost: e.amounts[0], salvage: e.amounts[1], usefulLifeMonths: months, inServiceDate: e.dates[0], assetId: e.ids.find((i) => i.startsWith("asset_")) }; } },
  { kind: "accounting.prepaid_amortization", weight: 2.5, any: [/\bprepaid\b/i, /\bamortiz/i], params: (m, e, _asOf) => ({ amount: e.amounts[0], months: e.durations.find((d) => d.unit === "MONTH")?.value ?? (e.durations.find((d) => d.unit === "YEAR") ? e.durations.find((d) => d.unit === "YEAR")!.value * 12 : undefined), startDate: e.dates[0], expenseAccountCode: guessExpenseCode(m, e.accountCodes) }) },
  { kind: "accounting.accrual", weight: 2.5, any: [/\baccru(e|al|ed)\b/i], params: (m, e, asOf) => ({ amount: e.amounts[0], expenseAccountCode: guessExpenseCode(m, e.accountCodes), periodEnd: e.dates[0] ?? monthEnd(e.months[0] ? `${e.months[0]}-01` : asOf), description: m }) },
  { kind: "accounting.trial_balance", weight: 2.5, any: [/\btrial balance\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0], from: e.dates[1] }) },
  { kind: "accounting.explain_statement", weight: 2.4, all: [/\b(explain|why (did|is|was|has)|what (drove|changed|happened)|walk me through|break down)\b/i], any: [/\bincome statement\b/i, /\bp&l\b/i, /\bprofit\b/i, /\bbalance sheet\b/i, /\bcash flow\b/i, /\bnet income\b/i, /\bexpenses?\b/i, /\brevenue\b/i], none: [/\bwhy did (the cfo|tau|you|the system)\b/i], params: (m, _e, asOf) => ({ statement: /\bbalance sheet\b/i.test(m) ? "BALANCE_SHEET" : /\bcash flow\b/i.test(m) ? "CASH_FLOW" : "INCOME_STATEMENT", ...range(m, asOf), focus: undefined }) },
  { kind: "accounting.financial_statements", weight: 2, any: [/\bincome statement\b/i, /\bbalance sheet\b/i, /\bcash flow statement\b/i, /\bp&l\b/i, /\bprofit (and|&) loss\b/i, /\bfinancial statements?\b/i, /\bstatements? for\b/i, /\bnet income\b/i, /\bhow much (profit|did we (make|earn))\b/i], params: (m, _e, asOf) => range(m, asOf) },
  { kind: "accounting.journal_entry_draft", weight: 2, any: [/\bjournal entry\b/i, /\bdraft (an? |the )?entry\b/i, /\bbook (an? |the )?entry\b/i, /\brecord (the |an? )?(expense|purchase|revenue|distribution|equipment|depreciation|transfer|refund|loan|payment)\b/i, /\bentry (for|to)\b/i, /\bhow (do i|should i|would you) (book|record)\b/i], params: (m, e, _asOf) => { const t = eventType(m); return { description: m, date: e.dates[0], event: t ? { type: t, amount: e.amounts[0], expenseAccountCode: guessExpenseCode(m, e.accountCodes), months: e.durations.find((d) => d.unit === "MONTH")?.value } : undefined }; } },
];

export function createControllerAgent(): Specialist {
  return new Specialist({
    name: "controller",
    description: "Controller: journal entries, statements, trial balance, accruals, prepaids, depreciation, reconciliations and the month-end close.",
    keywords: [/\bjournal\b/i, /\bentry\b/i, /\bstatement/i, /\bledger\b/i, /\bclose\b/i, /\bperiod\b/i, /\breconcil/i, /\baccru/i, /\bprepaid\b/i, /\bdepreciat/i, /\btrial balance\b/i, /\bbalance sheet\b/i, /\bincome statement\b/i, /\bp&l\b/i, /\bnet income\b/i, /\bbook(ing)?\b/i],
    rules,
    tools: [
      [draftJournalEntryTool, "accounting.journal_entry_draft"],
      [postJournalEntryTool, "accounting.post_journal_entry"],
      [financialStatementsTool, "accounting.financial_statements"],
      [trialBalanceTool, "accounting.trial_balance"],
      [explainStatementTool, "accounting.explain_statement"],
      [depreciationScheduleTool, "accounting.depreciation_schedule"],
      [prepaidAmortizationTool, "accounting.prepaid_amortization"],
      [accrualTool, "accounting.accrual"],
      [correctingEntryTool, "accounting.correcting_entry"],
      [bankReconciliationTool, "accounting.bank_reconciliation"],
      [closePeriodTool, "accounting.close_period"],
      [modifyClosedPeriodTool, "accounting.modify_closed_period"],
    ],
  });
}

export { accountingCloseTools };
