/**
 * Auditor / controls tools. These run on the auditor's isolated context (fresh Ledger over a
 * cloned dataset): integrity checks, risk assessment of a hypothetical action, personal/business
 * separation checks with policy citations, "why did the CFO do this" explanations and independent
 * report verification.
 */
import { whyDidTheCfoDoThis } from "@/lib/audit/explain";
import { fiscalYearStart } from "@/lib/accounting/periods";
import { nowISO } from "@/lib/core/dates";
import { newId } from "@/lib/core/ids";
import { D, money } from "@/lib/core/money";
import type { ActionKind, DecimalString, ProposedAction } from "@/lib/core/types";
import { makeCalc } from "@/lib/finance/calc-result";
import { POLICY_KEYS, policyByKey } from "@/lib/knowledge/policies";
import { PHASE_ONE_PROHIBITED_KINDS } from "@/lib/risk/risk-engine";
import { classifyTransaction } from "../classification";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, insufficient, moneyFigure, ok, textFigure } from "./common";
import { extractEntities } from "../intent";

const KNOWN_ACTION_KINDS = new Set<string>(["CALCULATE", "GENERATE_REPORT", "RUN_RECONCILIATION", "UPDATE_FORECAST", "CATEGORIZE_TRANSACTION", "MATCH_PAYMENT", "FLAG_MISSING_RECEIPT", "CREATE_JOURNAL_ENTRY", "POST_JOURNAL_ENTRY", "REVERSE_JOURNAL_ENTRY", "CREATE_VENDOR", "CREATE_CUSTOMER", "RECORD_BILL", "RECORD_INVOICE", "SCHEDULE_PAYMENT", "EXECUTE_PAYMENT", "REIMBURSEMENT", "PROPOSE_DISTRIBUTION", "RUN_PAYROLL", "CHANGE_PAYROLL", "SET_COMPENSATION_POLICY", "FILE_TAX_RETURN", "PAY_TAX", "RESPOND_TO_TAX_AUTHORITY", "CHANGE_ACCOUNTING_POLICY", "CHANGE_ENTITY", "CLASSIFY_INTERNATIONAL_WORKER", "DELETE_RECORD", "MODIFY_CLOSED_PERIOD", "LOCK_PERIOD", "UNLOCK_PERIOD", "SEND_COLLECTION_REMINDER", "UPDATE_POLICY", "UPDATE_CONFIG", "SIGN_DOCUMENT", "OTHER"]);

export const integrityCheckTool = defineTool({
  name: "integrity_check",
  description: "Run the ledger integrity and reconciliation invariants as of a date (independent verification).",
  riskLevel: "GREEN",
  capabilityKey: "internal_audit",
  inputSchema: TASKS["accounting.integrity_check"].params,
  async execute(input, ctx) {
    const r = ctx.ledger.runIntegrityChecks(input.asOf);
    const failed = r.checks.filter((c) => !c.passed);
    const errors = failed.filter((c) => c.severity === "ERROR");
    const calc = makeCalc<number>({ name: "integrity_failures", value: failed.length, unit: "COUNT", formula: "count(checks not passed)", inputs: { asOf: input.asOf, checks: r.checks.map((c) => ({ key: c.key, passed: c.passed, severity: c.severity })) }, asOfDate: input.asOf });
    return ok({
      answer: r.passed ? `All ${r.checks.length} integrity checks pass as of ${input.asOf}: every posted entry balances, the trial balance and balance sheet balance, cash flow reconciles, suspense is clear for locked periods.` : `${failed.length} of ${r.checks.length} integrity checks fail as of ${input.asOf} (${errors.length} errors): ${failed.map((c) => `${c.key}${c.details ? ` — ${c.details}` : ""}`).join("; ")}.`,
      numbers: [textFigure("Checks", r.checks.length), textFigure("Passed", r.checks.length - failed.length), textFigure("Failed", failed.length, errors.length ? `${errors.length} errors` : undefined)],
      why: r.checks.map((c) => `${c.passed ? "PASS" : "FAIL"} [${c.severity}] ${c.label}${c.details ? `: ${c.details}` : ""}`),
      risks: errors.length ? ["Integrity errors block period lock and undermine every report until resolved."] : failed.length ? ["Warnings indicate subledger/GL differences to investigate."] : [],
      recommendation: r.passed ? "No action needed." : "Resolve the failing checks before closing the period.",
      confidence: 0.95,
      structured: { value: failed.length, values: { checks: r.checks.length, failed: failed.length, errors: errors.length }, passed: r.passed, checks: r.checks },
    }, { calcs: [calc] });
  },
});

export const riskAssessTool = defineTool({
  name: "risk_assess",
  description: "Assess the risk level (GREEN/YELLOW/RED), reasons and approver roles for a described action without submitting it.",
  riskLevel: "GREEN",
  capabilityKey: "internal_audit",
  inputSchema: TASKS["controls.risk_assess"].params,
  async execute(input, ctx) {
    const kind = input.kind.toUpperCase().replace(/[\s-]+/g, "_") as ActionKind;
    const action: ProposedAction = { id: newId("pa"), kind, agent: ctx.agent, description: input.description, amount: input.amount === undefined ? undefined : { amount: money(input.amount), currency: "USD" }, targetIds: [], payload: { ...((input.context?.payload as Record<string, unknown> | undefined) ?? {}), ...(input.context?.exactMatch !== undefined ? { exactMatch: input.context.exactMatch } : {}), ...(input.context?.matchType !== undefined ? { matchType: input.context.matchType } : {}) }, reason: "risk assessment request", sourceDocumentIds: [], confidence: 1, reversible: true, createdAt: nowISO(), context: { ...((input.context ?? {}) as ProposedAction["context"]), ...(input.context?.exactMatch === true ? { isExactMatch: true } : {}) } };
    const assessed = ctx.risk.assess(action, { thresholds: ctx.thresholds });
    const known = KNOWN_ACTION_KINDS.has(kind);
    const r = known ? assessed : { ...assessed, level: (assessed.level === "RED" ? "RED" : "YELLOW") as "RED" | "YELLOW", autoExecutable: false, requiredApproverRoles: assessed.requiredApproverRoles.length ? assessed.requiredApproverRoles : ["OWNER" as const], reasons: [`"${kind}" is not a recognized action kind; unknown actions are never auto-executed and default to YELLOW review.`, ...assessed.reasons] };
    const prohibited = (PHASE_ONE_PROHIBITED_KINDS as readonly string[]).includes(kind);
    return ok({
      answer: `"${input.description}" (${kind}${input.amount !== undefined ? `, ${money(input.amount)}` : ""}) is ${r.level}${prohibited ? " and prohibited from executing in Phase One" : ""}: ${r.reasons.join(" ")} ${r.level === "GREEN" ? "No approval is required." : `Approvers: ${r.requiredApproverRoles.join(", ")}.`}`,
      numbers: [textFigure("Risk level", r.level), textFigure("Approvers", r.requiredApproverRoles.join(", ") || "none"), textFigure("Auto-executable", r.autoExecutable ? "yes" : "no"), ...(input.amount !== undefined ? [moneyFigure("Amount", money(input.amount))] : [])],
      why: r.reasons,
      risks: prohibited ? [`${kind} never executes in Phase One (simulation only).`] : [],
      confidence: 0.95,
      sourceRefs: r.policyRefs.map((p) => ({ id: p, kind: "POLICY" as const, label: p })),
      structured: { value: r.level, riskLevel: r.level, assessment: { level: r.level, reasons: r.reasons, requiredApproverRoles: r.requiredApproverRoles, materialityBreached: r.materialityBreached, autoExecutable: r.autoExecutable, policyRefs: r.policyRefs }, phaseOneProhibited: prohibited, actionKind: kind, knownActionKind: known },
    });
  },
});

export const personalBusinessCheckTool = defineTool({
  name: "personal_business_check",
  description: "Check a transaction for personal/business mixing against the separation and meals policies.",
  riskLevel: "GREEN",
  capabilityKey: "internal_audit",
  inputSchema: TASKS["controls.personal_business_check"].params,
  async execute(input, ctx) {
    const tx = input.transactionId ? ctx.dataset.transactions.find((t) => t.id === input.transactionId) : undefined;
    if (input.transactionId && !tx) return ok(insufficient([`transaction ${input.transactionId}`], `No transaction ${input.transactionId}.`));
    const description = input.description ?? tx?.descriptionRaw ?? "";
    if (!description && !input.merchant) return ok(insufficient(["transaction description"], "Describe the transaction (merchant, amount, date, purpose)."));
    const ents = extractEntities(`${description} ${input.notes ?? ""}`, ctx.asOfDate);
    const r = classifyTransaction(ctx.dataset, { description, merchant: input.merchant ?? tx?.merchantNormalized, amount: input.amount ?? tx?.amount ?? null, date: tx?.date ?? ents.dates[0], sourceKind: tx?.sourceKind, hasReceipt: tx ? tx.documentIds.length > 0 : /\b(no|without|missing) receipt\b/i.test(input.notes ?? "") ? false : undefined, notes: input.notes });
    const relatedParty = r.flags.includes("RELATED_PARTY");
    const personal = r.flags.includes("POSSIBLE_PERSONAL") || r.accountCode === "7990" || relatedParty;
    const sep = policyByKey(ctx.dataset.policies, POLICY_KEYS.PERSONAL_BUSINESS_SEPARATION);
    const meals = policyByKey(ctx.dataset.policies, POLICY_KEYS.MEALS);
    const sourceRefs = [sep, ...(r.accountCode === "7300" ? [meals] : [])].filter((p): p is NonNullable<typeof p> => Boolean(p)).map((p) => ({ id: p.id, kind: "POLICY" as const, label: p.title, status: p.status }));
    const verdict = relatedParty ? "RELATED_PARTY" : personal ? "POSSIBLE_PERSONAL" : r.escalation ? "UNDETERMINED" : "BUSINESS";
    const amountStr: DecimalString | null = input.amount !== undefined ? money(input.amount) : tx?.amount ?? null;
    return ok({
      answer: verdict === "RELATED_PARTY" ? `This is a payment to the owner / a related party: ${r.reason} It is a shareholder distribution (restricted account 3100), a reimbursement or a loan repayment — never a business expense — and requires owner approval on file plus CPA visibility for basis.` : verdict === "POSSIBLE_PERSONAL" ? `This looks personal or mixed-use: ${r.reason} Under the separation policy it is categorized to 7990 Non-Deductible / Personal (Review) unless a business purpose is documented — it is never booked as a business expense on instruction alone.` : verdict === "UNDETERMINED" ? `I can't tell whether this is business or personal: ${r.reason}` : `No personal-use indicators found: ${r.reason} Suggested account ${r.accountCode}.`,
      numbers: [textFigure("Verdict", verdict), textFigure("Suggested account", r.accountCode ?? "none"), ...(amountStr ? [moneyFigure("Amount", amountStr)] : [])],
      why: [r.reason, ...(sep ? [`Policy: ${sep.title} (${sep.status}) — ${sep.body.slice(0, 160)}…`] : []), ...(r.accountCode === "7300" && meals ? [`Policy: ${meals.title} (${meals.status}) — business purpose and attendees required.`] : [])],
      risks: personal ? ["Treating personal spend as business misstates profit and the tax return."] : [],
      escalation: r.escalation ? esc("CANNOT_CLASSIFY", r.reason) : undefined,
      recommendation: relatedParty ? "Record it as a shareholder distribution only with an approval on file; otherwise treat it as due from shareholder pending review." : personal ? "Document the business purpose and attendees, or confirm it is personal so it is booked to 7990 and, if paid by the company, treated as a shareholder item for the CPA." : "Proceed with the suggested categorization.",
      educationKey: "personal_business_separation",
      confidence: personal ? 0.8 : r.confidence,
      sourceRefs,
      sourceLayers: ["COMPANY"],
      structured: { value: verdict, verdict, category: { accountCode: r.accountCode, confidence: r.confidence, status: r.status, flags: r.flags, reason: r.reason }, policyIds: sourceRefs.map((s) => s.id) },
    }, { sourceIds: tx ? [tx.id] : [] });
  },
});

export const auditExplainTool = defineTool({
  name: "audit_explain",
  description: "Why did the CFO do this? Reconstructs the audit trail for an action, approval, entry, calculation or document id.",
  riskLevel: "GREEN",
  capabilityKey: "internal_audit",
  inputSchema: TASKS["controls.audit_explain"].params,
  async execute(input, ctx) {
    const ex = whyDidTheCfoDoThis(ctx.audit, ctx.dataset, input.targetId);
    const steps = ex.steps ?? [];
    if (!steps.length && (ex.resolvedAs.length === 0 || ex.resolvedAs.includes("UNKNOWN"))) return ok(insufficient([`a record with id ${input.targetId}`], `Nothing in the audit trail or dataset references ${input.targetId}.`));
    return ok({
      answer: `${input.targetId} resolves to ${ex.resolvedAs.join(", ") || "an audit event"} with ${steps.length} audit event(s): ${steps.slice(0, 5).map((s) => `#${s.seq} ${s.eventType} by ${s.actor}`).join("; ")}${steps.length > 5 ? "…" : ""}.`,
      numbers: [textFigure("Audit events", steps.length), textFigure("Resolved as", ex.resolvedAs.join(", ") || "unknown")],
      why: steps.slice(0, 12).map((s) => `#${s.seq} ${s.at} ${s.eventType} (${s.actor}): ${String((s as { explanation?: string }).explanation ?? (s as { summary?: string }).summary ?? "").slice(0, 200)}`),
      confidence: 0.9,
      structured: { value: steps.length, explanation: ex },
    }, { sourceIds: ex.sourceDocumentIds ?? [] });
  },
});

export const verifyReportTool = defineTool({
  name: "verify_report",
  description: "Independently recompute statements on a fresh ledger and confirm they balance and reconcile.",
  riskLevel: "GREEN",
  capabilityKey: "internal_audit",
  inputSchema: TASKS["controls.verify_report"].params,
  async execute(input, ctx) {
    const is = ctx.ledger.incomeStatement(input.from, input.to);
    const bs = ctx.ledger.balanceSheet(input.to);
    const cf = ctx.ledger.cashFlowStatement(input.from, input.to);
    const tb = ctx.ledger.trialBalance(input.to);
    const integrity = ctx.ledger.runIntegrityChecks(input.to);
    const ytdCf = ctx.ledger.cashFlowStatement(fiscalYearStart(input.to), input.to);
    const checks = [
      { key: "trial-balance", passed: tb.balanced, detail: `debits ${tb.totalDebits} vs credits ${tb.totalCredits}` },
      { key: "balance-sheet", passed: bs.balanced, detail: `difference ${bs.difference}` },
      { key: "cash-flow-period", passed: cf.reconciled, detail: `difference ${cf.difference}` },
      { key: "cash-flow-ytd", passed: ytdCf.reconciled, detail: `difference ${ytdCf.difference}` },
      { key: "net-income-ties", passed: D(cf.netIncome).eq(D(is.netIncome)), detail: `IS ${is.netIncome} vs CF ${cf.netIncome}` },
      { key: "integrity", passed: integrity.passed, detail: `${integrity.checks.filter((c) => !c.passed).length} failing` },
    ];
    const failed = checks.filter((c) => !c.passed);
    const calc = makeCalc<DecimalString>({ name: "verified_net_income", value: is.netIncome, unit: "USD", formula: "income statement recomputed on an isolated ledger clone", inputs: { from: input.from, to: input.to, checks }, asOfDate: input.to });
    return ok({
      answer: failed.length ? `Verification FAILED for ${input.from}–${input.to}: ${failed.map((c) => `${c.key} (${c.detail})`).join("; ")}. Recomputed net income ${is.netIncome}, cash ${bs.cash}.` : `Verified: statements for ${input.from}–${input.to} recompute cleanly on an isolated ledger — net income ${is.netIncome}, total assets ${bs.totalAssets}, cash ${bs.cash}; trial balance, balance sheet and cash flow all reconcile.`,
      numbers: [moneyFigure("Net income (verified)", is.netIncome, calc.id), moneyFigure("Total assets", bs.totalAssets), moneyFigure("Cash", bs.cash), textFigure("Checks passed", `${checks.length - failed.length}/${checks.length}`)],
      why: checks.map((c) => `${c.passed ? "PASS" : "FAIL"} ${c.key}: ${c.detail}`),
      risks: failed.length ? ["Do not distribute this report until the failing checks are resolved."] : [],
      confidence: failed.length ? 0.5 : 0.95,
      structured: { value: is.netIncome, values: { netIncome: is.netIncome, revenue: is.revenue, totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity, cash: bs.cash }, verified: failed.length === 0, checks, balanced: bs.balanced, reconciled: cf.reconciled },
    }, { calcs: [calc] });
  },
});

export const controlsTools = [integrityCheckTool, riskAssessTool, personalBusinessCheckTool, auditExplainTool, verifyReportTool];
