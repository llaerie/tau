/**
 * Controller tools: journal entry drafting from business events or explicit lines, posting,
 * statements, trial balance and statement explanation. Drafts are proposed as
 * CREATE_JOURNAL_ENTRY / POST_JOURNAL_ENTRY actions and go through governance; nothing here
 * writes to the ledger directly.
 */
import { z } from "zod";
import type { NewJournalEntryInput, NewJournalLineInput, ToolContext } from "@/lib/core/contracts";
import type { CalcResult, DecimalString, ISODate, JournalSource } from "@/lib/core/types";
import { ACCT } from "@/lib/accounting/chart-of-accounts";
import { addMonths, daysBetween, monthKey } from "@/lib/core/dates";
import { D, allocate, money, sub } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { accountName, esc, insufficient, line, moneyFigure, ok, periodStatusAt, propose, structuredEntry, textFigure, type StructuredEntry } from "./common";

type DraftParams = z.infer<(typeof TASKS)["accounting.journal_entry_draft"]["params"]>;
type EventSpec = NonNullable<DraftParams["event"]>;

const num = (v: string | number | undefined | null): DecimalString | null => (v === null || v === undefined || v === "" ? null : money(v));

/** Build the lines for a standard business event. Returns null lines + missing list when inputs are absent. */
export function linesForEvent(ev: EventSpec, description: string): { lines: NewJournalLineInput[]; source: JournalSource; missing: string[]; context: Record<string, boolean> } {
  const amt = num(ev.amount);
  const x = ev.extra ?? {};
  const xv = (k: string) => num(x[k]);
  const exp = ev.expenseAccountCode;
  const missing: string[] = [];
  const need = (label: string, v: DecimalString | null) => {
    if (v === null) missing.push(label);
    return v ?? "0.0000";
  };
  const ctxFlags: Record<string, boolean> = {};
  let source: JournalSource = "MANUAL";
  let lines: NewJournalLineInput[] = [];
  const two = (dr: string, cr: string, a: DecimalString) => [line(dr, "debit", a, description), line(cr, "credit", a, description)];
  const expCode = (fallback: string) => exp ?? fallback;
  switch (ev.type) {
    case "REVENUE_ON_CREDIT": source = "AR"; lines = two(ACCT.AR, expCode(ACCT.SERVICE_REVENUE), need("amount", amt)); break;
    case "CASH_REVENUE": source = "AR"; lines = two(ACCT.CHECKING, expCode(ACCT.SERVICE_REVENUE), need("amount", amt)); break;
    case "COLLECT_RECEIVABLE": source = "AR"; lines = two(ACCT.CHECKING, ACCT.AR, need("amount", amt)); break;
    case "EXPENSE_ON_CARD": source = "CARD_IMPORT"; if (!exp) missing.push("expenseAccountCode"); lines = two(expCode(ACCT.SUSPENSE), ACCT.CREDIT_CARD, need("amount", amt)); break;
    case "EXPENSE_FROM_BANK": source = "BANK_IMPORT"; if (!exp) missing.push("expenseAccountCode"); lines = two(expCode(ACCT.SUSPENSE), ACCT.CHECKING, need("amount", amt)); break;
    case "BILL_RECEIVED": source = "AP"; if (!exp) missing.push("expenseAccountCode"); lines = two(expCode(ACCT.SUSPENSE), ACCT.AP, need("amount", amt)); break;
    case "PAY_BILL": source = "AP"; lines = two(ACCT.AP, ACCT.CHECKING, need("amount", amt)); break;
    case "PREPAID_PURCHASE": source = "BANK_IMPORT"; lines = two(ACCT.PREPAID, x.paidFromCode ? String(x.paidFromCode) : ACCT.CHECKING, need("amount", amt)); break;
    case "PREPAID_AMORTIZATION": {
      source = "ADJUSTING";
      const total = need("amount", amt);
      const monthly = ev.months && ev.months > 0 ? allocate(total, Array.from({ length: ev.months }, () => 1))[0] : total;
      if (!exp) missing.push("expenseAccountCode");
      lines = two(expCode(ACCT.SUSPENSE), ACCT.PREPAID, monthly);
      break;
    }
    case "ACCRUE_EXPENSE": source = "ADJUSTING"; if (!exp) missing.push("expenseAccountCode"); lines = two(expCode(ACCT.SUSPENSE), ACCT.ACCRUED_EXPENSES, need("amount", amt)); break;
    case "REVERSE_ACCRUAL": source = "REVERSAL"; if (!exp) missing.push("expenseAccountCode"); lines = two(ACCT.ACCRUED_EXPENSES, expCode(ACCT.SUSPENSE), need("amount", amt)); break;
    case "EQUIPMENT_PURCHASE": source = "BANK_IMPORT"; lines = two(x.assetCode ? String(x.assetCode) : ACCT.COMPUTER_EQUIPMENT, x.paidFromCode ? String(x.paidFromCode) : ACCT.CHECKING, need("amount", amt)); break;
    case "DEPRECIATION": source = "DEPRECIATION"; lines = two(ACCT.DEPRECIATION, ACCT.ACCUM_DEPR, need("amount", amt)); break;
    case "OWNER_CAPITAL_CONTRIBUTION": ctxFlags.touchesEquity = true; ctxFlags.involvesRelatedParty = true; lines = two(ACCT.CHECKING, ACCT.CAPITAL, need("amount", amt)); break;
    case "SHAREHOLDER_DISTRIBUTION": ctxFlags.touchesEquity = true; ctxFlags.involvesRelatedParty = true; ctxFlags.touchesRestrictedAccount = true; lines = two(ACCT.DISTRIBUTIONS, ACCT.CHECKING, need("amount", amt)); break;
    case "TRANSFER_BETWEEN_ACCOUNTS": source = "BANK_IMPORT"; lines = two(x.toCode ? String(x.toCode) : ACCT.SAVINGS, x.fromCode ? String(x.fromCode) : ACCT.CHECKING, need("amount", amt)); break;
    case "BANK_FEE": source = "BANK_IMPORT"; lines = two(ACCT.BANK_FEES, ACCT.CHECKING, need("amount", amt)); break;
    case "REFUND_RECEIVED": source = "BANK_IMPORT"; if (!exp) missing.push("expenseAccountCode"); lines = two(ACCT.CHECKING, expCode(ACCT.SUSPENSE), need("amount", amt)); break;
    case "PAYROLL_RUN": {
      source = "PAYROLL";
      ctxFlags.touchesPayroll = true;
      const gross = amt ?? need("amount or extra.gross", xv("gross"));
      const netPay = need("extra.netPay", xv("netPay"));
      const lineStyle = xv("socialSecurityEmployer") !== null || xv("federalIncomeTaxWithheld") !== null;
      const sum = (...keys: string[]) => keys.reduce((acc, k) => acc.plus(D(xv(k) ?? 0)), D(0)).toFixed(4);
      // Either PayrollLine-style components (employee/employer taxes itemized) or pre-summarized payables.
      const employerTaxes = lineStyle ? sum("socialSecurityEmployer", "medicareEmployer", "federalUnemploymentEmployer", "stateUnemploymentEmployer", "stateTrainingTaxEmployer") : xv("employerTaxes") ?? "0.0000";
      const fed = lineStyle ? sum("federalIncomeTaxWithheld", "socialSecurityEmployee", "medicareEmployee", "socialSecurityEmployer", "medicareEmployer") : xv("federalPayable") ?? "0.0000";
      const state = lineStyle ? sum("stateIncomeTaxWithheld", "stateDisabilityEmployee") : xv("statePayable") ?? "0.0000";
      const futa = lineStyle ? sum("federalUnemploymentEmployer") : xv("futaPayable") ?? "0.0000";
      const sui = lineStyle ? sum("stateUnemploymentEmployer", "stateTrainingTaxEmployer") : xv("suiPayable") ?? "0.0000";
      lines = [line(x.officer ? ACCT.OFFICER_COMP : ACCT.SALARIES, "debit", gross, "Gross wages")];
      if (D(employerTaxes).gt(0)) lines.push(line(ACCT.EMPLOYER_PAYROLL_TAX, "debit", employerTaxes, "Employer payroll taxes"));
      lines.push(line(ACCT.CHECKING, "credit", netPay, "Net pay"));
      if (D(fed).gt(0)) lines.push(line(ACCT.FED_PAYROLL_TAX_PAYABLE, "credit", fed, "Federal withholding + FICA"));
      if (D(state).gt(0)) lines.push(line(ACCT.STATE_PAYROLL_TAX_PAYABLE, "credit", state, "State withholding + SDI"));
      if (D(futa).gt(0)) lines.push(line(ACCT.FUTA_PAYABLE, "credit", futa, "FUTA"));
      if (D(sui).gt(0)) lines.push(line(ACCT.SUI_PAYABLE, "credit", sui, "SUI + ETT"));
      break;
    }
    case "PAYROLL_TAX_PAYMENT": source = "PAYROLL"; ctxFlags.touchesPayroll = true; ctxFlags.touchesTax = true; lines = two(x.liabilityCode ? String(x.liabilityCode) : ACCT.FED_PAYROLL_TAX_PAYABLE, ACCT.CHECKING, need("amount", amt)); break;
    case "CARD_PAYMENT": source = "BANK_IMPORT"; lines = two(ACCT.CREDIT_CARD, ACCT.CHECKING, need("amount", amt)); break;
    case "LOAN_PROCEEDS": lines = two(ACCT.CHECKING, ACCT.LOANS, need("amount", amt)); break;
    case "LOAN_PAYMENT": {
      const principal = need("extra.principal", xv("principal"));
      const interest = xv("interest") ?? "0.0000";
      lines = [line(ACCT.LOANS, "debit", principal, "Principal")];
      if (D(interest).gt(0)) lines.push(line(ACCT.INTEREST_EXPENSE, "debit", interest, "Interest"));
      lines.push(line(ACCT.CHECKING, "credit", D(principal).plus(D(interest)).toFixed(4), "Loan payment"));
      break;
    }
    case "DEFERRED_REVENUE_RECEIPT": lines = two(ACCT.CHECKING, ACCT.DEFERRED_REVENUE, need("amount", amt)); break;
    case "RECOGNIZE_DEFERRED_REVENUE": source = "ADJUSTING"; lines = two(ACCT.DEFERRED_REVENUE, expCode(ACCT.SERVICE_REVENUE), need("amount", amt)); break;
    case "INTEREST_INCOME": source = "BANK_IMPORT"; lines = two(ACCT.CHECKING, ACCT.INTEREST_INCOME, need("amount", amt)); break;
  }
  return { lines, source, missing, context: ctxFlags };
}

function entryPresentation(ctx: ToolContext, entry: NewJournalEntryInput, se: StructuredEntry, extra: Record<string, unknown> = {}) {
  return {
    structured: { journalEntry: { date: se.date, description: se.description, source: se.source, lines: se.lines, balanced: se.balanced, totalDebits: se.totalDebits, totalCredits: se.totalCredits }, value: se.totalDebits, periodStatus: periodStatusAt(ctx, entry.date), ...extra },
    numbers: [moneyFigure("Total debits", se.totalDebits), moneyFigure("Total credits", se.totalCredits), textFigure("Lines", se.lines.length), textFigure("Balanced", se.balanced ? "yes" : "NO")],
  };
}

export const draftJournalEntryTool = defineTool({
  name: "draft_journal_entry",
  description: "Draft a balanced journal entry from a described business event or explicit lines; proposes CREATE_JOURNAL_ENTRY (draft) through governance.",
  riskLevel: "YELLOW",
  capabilityKey: "journal_entry_drafting",
  inputSchema: TASKS["accounting.journal_entry_draft"].params,
  async execute(input, ctx) {
    const date = input.date ?? ctx.asOfDate;
    let lines: NewJournalLineInput[] = [];
    let source: JournalSource = "MANUAL";
    let flags: Record<string, boolean> = {};
    if (input.lines && input.lines.length) {
      lines = input.lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit === undefined ? undefined : money(l.debit), credit: l.credit === undefined ? undefined : money(l.credit), memo: l.memo }));
    } else if (input.event) {
      const built = linesForEvent(input.event, input.description);
      if (built.missing.length) return ok(insufficient(built.missing, `I can draft the ${input.event.type} entry once I have: ${built.missing.join(", ")}. I don't invent amounts or accounts.`));
      lines = built.lines;
      source = built.source;
      flags = built.context;
    } else {
      return ok(insufficient(["lines or event"], "Describe the business event (e.g. { event: { type: 'EXPENSE_ON_CARD', amount, expenseAccountCode } }) or give explicit lines."));
    }
    const unknownAccounts = lines.filter((l) => !ctx.ledger.getAccount(l.accountId ?? l.accountCode ?? ""));
    if (unknownAccounts.length) return ok(insufficient(unknownAccounts.map((l) => `account ${l.accountCode ?? l.accountId}`), `Unknown account code(s): ${unknownAccounts.map((l) => l.accountCode ?? l.accountId).join(", ")}. Use codes from the chart of accounts.`));
    const entry: NewJournalEntryInput = { date, description: input.description, source, lines, tags: ["agent-draft"], post: input.post ?? false };
    const se = structuredEntry(ctx, entry);
    if (!se.balanced) {
      return ok({
        answer: `The described entry does not balance (debits ${se.totalDebits} vs credits ${se.totalCredits}). I will not adjust a line to force it; please confirm the amounts.`,
        escalation: esc("INSUFFICIENT_INFORMATION", `Unbalanced entry: debits ${se.totalDebits} != credits ${se.totalCredits}.`, { missingItems: ["balancing amount"] }),
        confidence: 0.4,
        ...entryPresentation(ctx, entry, se, { balanced: false }),
      });
    }
    const periodStatus = periodStatusAt(ctx, date);
    const suspense = se.lines.some((l) => l.accountCode === ACCT.SUSPENSE);
    const action = propose(ctx, {
      kind: "CREATE_JOURNAL_ENTRY",
      description: `Draft journal entry ${date}: ${input.description} (${se.lines.length} lines, ${se.totalDebits})`,
      reason: input.event ? `Standard ${input.event.type} event.` : "Explicit lines supplied by the requester.",
      amount: se.totalDebits,
      payload: { entry, lines: se.lines.map((l, i) => ({ accountId: se.accountIds[i], debit: l.debit, credit: l.credit })), accountIds: se.accountIds, post: input.post ?? false },
      context: { periodStatus, isNonStandard: !input.event || suspense, touchesRestrictedAccount: se.touchesRestrictedAccount, ...flags },
      confidence: input.event ? 0.9 : 0.75,
      reversible: true,
      rollbackPlan: "Void the draft, or reverse it if it has been posted.",
    });
    const why = [
      input.event ? `Event ${input.event.type} maps to the standard posting pattern: ${se.lines.map((l) => `${D(l.debit).gt(0) ? "Dr" : "Cr"} ${l.accountCode} ${l.accountName ?? ""} ${D(l.debit).gt(0) ? l.debit : l.credit}`).join("; ")}.` : "Lines were supplied explicitly and validated against the chart of accounts.",
      `Debits ${se.totalDebits} equal credits ${se.totalCredits}; the entry is balanced.`,
    ];
    const risks: string[] = [];
    if (periodStatus === "LOCKED") risks.push(`Period ${monthKey(date)} is LOCKED: the entry cannot be posted there; use a correcting entry in an open period.`);
    if (suspense) risks.push("An expense account was not specified so the suspense account 9999 is used; it must be cleared before the period closes.");
    if (se.touchesRestrictedAccount) risks.push("Touches a restricted account (equity / shareholder); owner and CPA review required.");
    return ok({ answer: `Drafted a balanced ${se.lines.length}-line entry for ${date}: "${input.description}" totaling ${se.totalDebits}. It is proposed as a DRAFT and will not affect balances until approved and posted.`, why, risks, recommendation: periodStatus === "LOCKED" ? "Re-date the entry to an open period or request a correcting entry." : "Review the draft lines and approve to create it in the ledger.", confidence: 0.85, ...entryPresentation(ctx, entry, se) }, { proposedActions: [action] });
  },
});

export const postJournalEntryTool = defineTool({
  name: "post_journal_entry",
  description: "Post an existing DRAFT journal entry (proposes POST_JOURNAL_ENTRY; locked periods escalate).",
  riskLevel: "YELLOW",
  capabilityKey: "journal_entry_posting",
  inputSchema: TASKS["accounting.post_journal_entry"].params,
  async execute(input, ctx) {
    const entry = ctx.dataset.journalEntries.find((e) => e.id === input.entryId);
    if (!entry) return ok(insufficient([`journal entry ${input.entryId}`], `No journal entry ${input.entryId} exists.`));
    const se = structuredEntry(ctx, { date: entry.date, description: entry.description, source: entry.source, lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo })) });
    if (entry.status !== "DRAFT" && entry.status !== "PENDING_APPROVAL") {
      return ok({ answer: `Entry #${entry.entryNumber} is ${entry.status}; only DRAFT or PENDING_APPROVAL entries can be posted. Posted entries are corrected by reversal, never edited.`, escalation: esc("APPROVAL_REQUIRED", `Entry ${entry.id} is ${entry.status}.`), confidence: 0.9, ...entryPresentation(ctx, entry, se, { entryId: entry.id, status: entry.status }) });
    }
    const periodStatus = periodStatusAt(ctx, entry.date);
    if (periodStatus === "LOCKED") {
      const action = propose(ctx, { kind: "MODIFY_CLOSED_PERIOD", description: `Post entry #${entry.entryNumber} into LOCKED period ${entry.periodId}`, reason: "Requested posting targets a locked period.", amount: se.totalDebits, targetIds: [entry.id], payload: { entryId: entry.id, periodId: entry.periodId }, context: { periodStatus }, reversible: false });
      return ok({ answer: `Entry #${entry.entryNumber} is dated in LOCKED period ${entry.periodId}. The ledger refuses to post there; changing a locked period is a RED action requiring owner and CPA approval.`, escalation: esc("APPROVAL_REQUIRED", `Period ${entry.periodId} is LOCKED.`, { requiredRole: "OWNER" }), risks: ["Locked periods are immutable; a dated correcting entry in the open period is the compliant path."], confidence: 0.9, ...entryPresentation(ctx, entry, se, { entryId: entry.id, status: entry.status }) }, { proposedActions: [action] });
    }
    const action = propose(ctx, { kind: "POST_JOURNAL_ENTRY", description: `Post entry #${entry.entryNumber} ${entry.description} (${se.totalDebits})`, reason: "Draft reviewed; posting requested.", amount: se.totalDebits, targetIds: [entry.id], payload: { entryId: entry.id, approvalId: input.approvalId, accountIds: se.accountIds, lines: entry.lines.map((l) => ({ accountId: l.accountId })) }, context: { periodStatus, touchesRestrictedAccount: se.touchesRestrictedAccount, isNonStandard: entry.source === "MANUAL" || entry.source === "AGENT" }, rollbackPlan: "Reverse the posted entry." });
    return ok({ answer: `Entry #${entry.entryNumber} (${entry.description}, ${se.totalDebits}) is balanced and its period ${entry.periodId} is ${periodStatus}; posting has been proposed.`, why: [`Entry balances (${se.totalDebits} / ${se.totalCredits}).`, `Period ${entry.periodId} status: ${periodStatus}.`], confidence: 0.9, ...entryPresentation(ctx, entry, se, { entryId: entry.id, status: entry.status }) }, { proposedActions: [action], sourceIds: [entry.id, ...entry.sourceIds] });
  },
});

function statementCalc(name: string, value: DecimalString, formula: string, from: ISODate | undefined, to: ISODate, sourceIds: string[]): CalcResult<DecimalString> {
  return makeCalc<DecimalString>({ name, value, unit: "USD", formula, inputs: { from: from ?? null, to }, asOfDate: to, sourceIds });
}

function entrySources(ctx: ToolContext, from: ISODate | undefined, to: ISODate): string[] {
  const ids = ctx.dataset.journalEntries.filter((e) => (e.status === "POSTED" || e.status === "REVERSED") && e.date <= to && (!from || e.date >= from)).map((e) => e.id);
  return ids.length > 40 ? ids.slice(-40) : ids;
}

export const financialStatementsTool = defineTool({
  name: "financial_statements",
  description: "Income statement, balance sheet and cash flow statement for a period, with balance/reconciliation checks.",
  riskLevel: "GREEN",
  capabilityKey: "financial_statements",
  inputSchema: TASKS["accounting.financial_statements"].params,
  async execute(input, ctx) {
    if (input.from > input.to) return fail_(`from ${input.from} is after to ${input.to}`);
    const is = ctx.ledger.incomeStatement(input.from, input.to);
    const bs = ctx.ledger.balanceSheet(input.to);
    const cf = ctx.ledger.cashFlowStatement(input.from, input.to);
    const src = entrySources(ctx, input.from, input.to);
    const calcs = [
      statementCalc("revenue", is.revenue, "sum(operating revenue credits - debits)", input.from, input.to, src),
      statementCalc("gross_profit", is.grossProfit, "revenue - cost_of_revenue", input.from, input.to, src),
      statementCalc("operating_expenses", is.operatingExpenses, "sum(operating expense accounts)", input.from, input.to, src),
      statementCalc("operating_income", is.operatingIncome, "gross_profit - operating_expenses", input.from, input.to, src),
      statementCalc("net_income", is.netIncome, "operating_income + other_income_expense", input.from, input.to, src),
      statementCalc("total_assets", bs.totalAssets, "sum(asset balances)", undefined, input.to, src),
      statementCalc("total_liabilities", bs.totalLiabilities, "sum(liability balances)", undefined, input.to, src),
      statementCalc("total_equity", bs.totalEquity, "sum(equity balances) + current year earnings", undefined, input.to, src),
      statementCalc("cash", bs.cash, "sum(cash account balances)", undefined, input.to, src),
      statementCalc("operating_cash_flow", cf.operating, "net income + non-cash adjustments + working capital changes", input.from, input.to, src),
      statementCalc("net_cash_change", cf.netChange, "operating + investing + financing", input.from, input.to, src),
    ];
    const risks: string[] = [];
    if (!bs.balanced) risks.push(`Balance sheet does not balance (difference ${bs.difference}).`);
    if (!cf.reconciled) risks.push(`Cash flow statement does not reconcile to cash (difference ${cf.difference}).`);
    const drafts = ctx.dataset.journalEntries.filter((e) => e.status === "DRAFT" && e.date >= input.from && e.date <= input.to).length;
    if (drafts) risks.push(`${drafts} DRAFT entries in the period are excluded from these statements.`);
    const margin = D(is.revenue).isZero() ? null : D(is.netIncome).div(D(is.revenue)).toNumber();
    return ok({
      answer: `For ${input.from} to ${input.to}: revenue ${is.revenue}, net income ${is.netIncome}; cash ${bs.cash}, total assets ${bs.totalAssets} against liabilities ${bs.totalLiabilities} and equity ${bs.totalEquity}. Balance sheet ${bs.balanced ? "balances" : "DOES NOT balance"}; cash flow ${cf.reconciled ? "reconciles" : "DOES NOT reconcile"}.`,
      numbers: calcs.map((c) => moneyFigure(c.name.replace(/_/g, " "), c.value, c.id)),
      why: [`Income statement: revenue ${is.revenue} − cost of revenue ${is.costOfRevenue} = gross profit ${is.grossProfit}; less operating expenses ${is.operatingExpenses} = operating income ${is.operatingIncome}; other ${is.otherIncomeExpense} → net income ${is.netIncome}.`, `Balance sheet at ${input.to}: assets ${bs.totalAssets} = liabilities ${bs.totalLiabilities} + equity ${bs.totalEquity} (difference ${bs.difference}).`, `Cash flow: operating ${cf.operating}, investing ${cf.investing}, financing ${cf.financing}; opening ${cf.openingCash} → closing ${cf.closingCash}.`],
      risks,
      recommendation: risks.length ? "Resolve the flagged integrity issues before relying on these statements." : "Statements are internally consistent; safe to use for management reporting (CPA review still applies for tax).",
      educationKey: "cash_vs_profit",
      confidence: risks.length ? 0.6 : 0.9,
      structured: { value: is.netIncome, values: { revenue: is.revenue, costOfRevenue: is.costOfRevenue, grossProfit: is.grossProfit, operatingExpenses: is.operatingExpenses, operatingIncome: is.operatingIncome, netIncome: is.netIncome, totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity, cash: bs.cash, currentAssets: bs.currentAssets, currentLiabilities: bs.currentLiabilities, operatingCashFlow: cf.operating, investingCashFlow: cf.investing, financingCashFlow: cf.financing, netCashChange: cf.netChange, netMargin: margin }, balanced: bs.balanced, reconciled: cf.reconciled, statements: { incomeStatement: is, balanceSheet: bs, cashFlow: cf } },
    }, { calcs, sourceIds: src });
  },
});

function fail_(message: string) {
  return { ok: false as const, error: message };
}

export const trialBalanceTool = defineTool({
  name: "trial_balance",
  description: "Trial balance as of a date (optionally activity from a start date).",
  riskLevel: "GREEN",
  capabilityKey: "financial_statements",
  inputSchema: TASKS["accounting.trial_balance"].params,
  async execute(input, ctx) {
    const tb = ctx.ledger.trialBalance(input.asOf, input.from);
    const src = entrySources(ctx, input.from, input.asOf);
    const calc = statementCalc("trial_balance_total_debits", tb.totalDebits, "sum(debit balances) — must equal sum(credit balances)", input.from, input.asOf, src);
    const nonZero = tb.rows.filter((r) => !D(r.balance).isZero());
    return ok({
      answer: `Trial balance as of ${input.asOf}: total debits ${tb.totalDebits}, total credits ${tb.totalCredits} — ${tb.balanced ? "balanced" : "NOT balanced"} across ${nonZero.length} accounts with activity.`,
      numbers: [moneyFigure("Total debits", tb.totalDebits, calc.id), moneyFigure("Total credits", tb.totalCredits), textFigure("Accounts with balances", nonZero.length), textFigure("Balanced", tb.balanced ? "yes" : "NO")],
      why: nonZero.slice(0, 12).map((r) => `${r.code} ${r.name}: ${r.balance}`),
      risks: tb.balanced ? [] : ["Trial balance is out of balance — a posted entry is unbalanced or corrupted; run the integrity check."],
      confidence: tb.balanced ? 0.95 : 0.5,
      structured: { value: tb.totalDebits, values: { totalDebits: tb.totalDebits, totalCredits: tb.totalCredits }, balanced: tb.balanced, rows: tb.rows.map((r) => ({ code: r.code, name: r.name, debit: r.debit, credit: r.credit, balance: r.balance })) },
    }, { calcs: [calc], sourceIds: src });
  },
});

export const explainStatementTool = defineTool({
  name: "explain_statement",
  description: "Explain a statement's main lines and their change versus the prior period of equal length in plain language.",
  riskLevel: "GREEN",
  capabilityKey: "financial_statements",
  inputSchema: TASKS["accounting.explain_statement"].params,
  async execute(input, ctx) {
    const days = daysBetween(input.from, input.to) + 1;
    const priorTo = addMonths(input.to, -Math.max(1, Math.round(days / 30)));
    const priorFrom = addMonths(input.from, -Math.max(1, Math.round(days / 30)));
    const src = entrySources(ctx, input.from, input.to);
    const focus = input.focus?.toLowerCase();
    const explain: string[] = [];
    const numbers = [];
    let headline = "";
    let value: DecimalString;
    if (input.statement === "INCOME_STATEMENT") {
      const cur = ctx.ledger.incomeStatement(input.from, input.to);
      const prior = ctx.ledger.incomeStatement(priorFrom, priorTo);
      value = cur.netIncome;
      headline = `Net income ${cur.netIncome} for ${input.from}–${input.to} versus ${prior.netIncome} in the prior period (${priorFrom}–${priorTo}), a change of ${sub(cur.netIncome, prior.netIncome)}.`;
      const pairs: [string, DecimalString, DecimalString][] = [["Revenue", cur.revenue, prior.revenue], ["Cost of revenue", cur.costOfRevenue, prior.costOfRevenue], ["Gross profit", cur.grossProfit, prior.grossProfit], ["Operating expenses", cur.operatingExpenses, prior.operatingExpenses], ["Operating income", cur.operatingIncome, prior.operatingIncome], ["Net income", cur.netIncome, prior.netIncome]];
      for (const [label, c, p] of pairs) {
        numbers.push(moneyFigure(label, c, undefined, `prior ${p}`));
        explain.push(`${label}: ${c} (prior ${p}, change ${sub(c, p)}).`);
      }
      const lines = cur.lines.filter((l) => !l.isTotal && l.code && !D(l.amount).isZero()).sort((a, b) => D(b.amount).abs().cmp(D(a.amount).abs())).slice(0, 6);
      for (const l of lines) {
        const pl = prior.lines.find((x) => x.code === l.code);
        explain.push(`${l.code} ${l.label}: ${l.amount}${pl ? ` (prior ${pl.amount}, change ${sub(l.amount, pl.amount)})` : " (no prior activity)"}.`);
      }
    } else if (input.statement === "BALANCE_SHEET") {
      const cur = ctx.ledger.balanceSheet(input.to);
      const prior = ctx.ledger.balanceSheet(priorTo);
      value = cur.totalAssets;
      headline = `Total assets ${cur.totalAssets} at ${input.to} (prior ${prior.totalAssets}); liabilities ${cur.totalLiabilities}, equity ${cur.totalEquity}; cash ${cur.cash} (change ${sub(cur.cash, prior.cash)}).`;
      for (const [label, c, p] of [["Cash", cur.cash, prior.cash], ["Current assets", cur.currentAssets, prior.currentAssets], ["Current liabilities", cur.currentLiabilities, prior.currentLiabilities], ["Total assets", cur.totalAssets, prior.totalAssets], ["Total liabilities", cur.totalLiabilities, prior.totalLiabilities], ["Total equity", cur.totalEquity, prior.totalEquity]] as [string, DecimalString, DecimalString][]) {
        numbers.push(moneyFigure(label, c, undefined, `prior ${p}`));
        explain.push(`${label}: ${c} (prior ${p}, change ${sub(c, p)}).`);
      }
    } else {
      const cur = ctx.ledger.cashFlowStatement(input.from, input.to);
      value = cur.netChange;
      headline = `Cash moved from ${cur.openingCash} to ${cur.closingCash} (${cur.netChange}): operating ${cur.operating}, investing ${cur.investing}, financing ${cur.financing}.`;
      for (const [label, c] of [["Net income", cur.netIncome], ["Operating cash flow", cur.operating], ["Investing", cur.investing], ["Financing", cur.financing], ["Net change", cur.netChange]] as [string, DecimalString][]) {
        numbers.push(moneyFigure(label, c));
      }
      for (const l of cur.operatingAdjustments) explain.push(`Operating adjustment ${l.label}: ${l.amount}.`);
      explain.push(cur.reconciled ? "The statement reconciles to the balance-sheet cash." : `The statement does NOT reconcile (difference ${cur.difference}).`);
    }
    const filtered = focus ? explain.filter((e) => e.toLowerCase().includes(focus)) : explain;
    return ok({ answer: headline, numbers, why: filtered.length ? filtered : explain, confidence: 0.85, educationKey: input.statement === "CASH_FLOW" ? "cash_vs_profit" : undefined, structured: { value, statement: input.statement, from: input.from, to: input.to, priorFrom, priorTo, explanations: explain } }, { sourceIds: src });
  },
});

export const accountingTools = [draftJournalEntryTool, postJournalEntryTool, financialStatementsTool, trialBalanceTool, explainStatementTool];
export { accountName };
