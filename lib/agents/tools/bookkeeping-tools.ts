/**
 * Bookkeeping tools: rule-based transaction classification (proposes CATEGORIZE_TRANSACTION),
 * duplicate detection, transfer matching and the exception queue.
 */
import { POLICY_KEYS, policyByKey } from "@/lib/knowledge/policies";
import { abs, D } from "@/lib/core/money";
import type { ProposedAction } from "@/lib/core/types";
import { classifyTransaction, detectDuplicates, exceptionQueue, matchTransfers } from "../classification";
import type { TransactionFlag } from "@/lib/core/types";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { accountName, esc, insufficient, moneyFigure, ok, propose, textFigure } from "./common";

export const classifyTransactionTool = defineTool({
  name: "classify_transaction",
  description: "Suggest a chart-of-accounts category for a bank/card transaction with confidence, flags and reasons (rule-based, deterministic).",
  riskLevel: "YELLOW",
  capabilityKey: "transaction_categorization",
  inputSchema: TASKS["accounting.classify_transaction"].params,
  async execute(input, ctx) {
    const tx = input.transactionId ? ctx.dataset.transactions.find((t) => t.id === input.transactionId) : undefined;
    if (input.transactionId && !tx) return ok(insufficient([`transaction ${input.transactionId}`], `No transaction ${input.transactionId} exists.`));
    const description = input.description ?? tx?.descriptionRaw;
    if (!description && !input.merchant) return ok(insufficient(["transaction description or merchant"], "Give me the transaction (id) or its description, amount and date."));
    const meta = (tx?.meta ?? {}) as Record<string, unknown>;
    const metaReceipt = meta.receipt === "none" ? false : meta.receipt === "attached" || meta.receipt === "present" ? true : undefined;
    const hasReceipt = input.hasReceipt ?? (tx ? (tx.documentIds.length > 0 ? true : metaReceipt) : undefined);
    const metaNotes = [typeof meta.businessPurpose === "string" ? `Business purpose: ${meta.businessPurpose}` : "", Array.isArray(meta.attendees) && meta.attendees.length ? `Attendees: ${(meta.attendees as string[]).join(", ")}` : ""].filter(Boolean).join("; ");
    const notes = [input.notes ?? "", metaNotes].filter(Boolean).join("; ") || undefined;
    const result = classifyTransaction(ctx.dataset, {
      description: description ?? "",
      merchant: input.merchant ?? tx?.merchantNormalized,
      amount: input.amount ?? tx?.amount ?? null,
      date: input.date ?? tx?.date,
      sourceKind: input.sourceKind ?? tx?.sourceKind,
      hasReceipt: hasReceipt === undefined ? (tx?.flags.includes("MISSING_RECEIPT") ? false : undefined) : hasReceipt,
      notes,
      counterpartyVendorId: tx?.counterpartyRef?.type === "VENDOR" ? tx.counterpartyRef.id : undefined,
    });
    if (tx) {
      // Dataset context: existing flags, duplicate detection against the ledger, worker/country context.
      const carried: TransactionFlag[] = tx.flags.filter((f) => ["POSSIBLE_DUPLICATE", "INTERNATIONAL", "RELATED_PARTY", "MISSING_RECEIPT", "LARGE_UNUSUAL", "REFUND", "TRANSFER", "SPLIT"].includes(f)) as TransactionFlag[];
      for (const f of carried) if (!result.flags.includes(f)) result.flags.push(f);
      if (!result.flags.includes("TRANSFER")) {
        const dupes = detectDuplicates(ctx.dataset, { transactionIds: [tx.id] }).filter((d) => d.transactionId === tx.id || d.duplicateOfId === tx.id);
        if (dupes.length && !result.flags.includes("POSSIBLE_DUPLICATE")) {
          result.flags.push("POSSIBLE_DUPLICATE", "REVIEW_REQUIRED");
          result.reason += ` Possible duplicate of ${dupes[0].duplicateOfId === tx.id ? dupes[0].transactionId : dupes[0].duplicateOfId} (${dupes[0].kind.toLowerCase().replace(/_/g, " ")}).`;
        }
      }
      const ref = tx.counterpartyRef;
      const worker = ref && (ref.type === "EMPLOYEE" || ref.type === "CONTRACTOR") ? ctx.dataset.workers.find((w) => w.id === ref.id) : undefined;
      if (worker && worker.country !== "US" && !result.flags.includes("INTERNATIONAL")) {
        result.flags.push("INTERNATIONAL", "REVIEW_REQUIRED");
        result.reason += ` Counterparty ${worker.displayName} is based in ${worker.country}; cross-border review applies.`;
      }
      result.flags = [...new Set(result.flags)];
    }
    const personal = result.flags.includes("POSSIBLE_PERSONAL");
    const policy = policyByKey(ctx.dataset.policies, POLICY_KEYS.PERSONAL_BUSINESS_SEPARATION);
    const mealsPolicy = policyByKey(ctx.dataset.policies, POLICY_KEYS.MEALS);
    const sourceRefs = [];
    if (personal && policy) sourceRefs.push({ id: policy.id, kind: "POLICY" as const, label: policy.title, status: policy.status });
    if (result.accountCode === "7300" && mealsPolicy) sourceRefs.push({ id: mealsPolicy.id, kind: "POLICY" as const, label: mealsPolicy.title, status: mealsPolicy.status });
    const amountStr = input.amount ?? tx?.amount;
    const proposed: ProposedAction[] = [];
    if (tx && result.accountId && !result.escalation && !result.flags.includes("TRANSFER")) {
      const approvedAccounts = new Set(ctx.dataset.transactions.filter((t) => t.category.status === "APPROVED").map((t) => t.category.accountId));
      proposed.push(propose(ctx, {
        kind: "CATEGORIZE_TRANSACTION",
        description: `Categorize ${tx.date} ${tx.descriptionRaw} (${tx.amount}) → ${accountName(ctx, result.accountCode)}`,
        reason: result.reason,
        amount: abs(tx.amount),
        targetIds: [tx.id],
        payload: { transactionId: tx.id, accountId: result.accountId, accountCode: result.accountCode, flags: result.flags },
        context: { isRecurringApproved: result.recurringApproved, isPersonalMixed: personal, isNewCategory: !approvedAccounts.has(result.accountId), involvesRelatedParty: result.flags.includes("RELATED_PARTY"), touchesRestrictedAccount: result.accountCode === "3100" || result.accountCode === "7990" },
        confidence: result.confidence,
        sourceDocumentIds: tx.documentIds,
        rollbackPlan: "Re-categorize the transaction; the ledger entry (if any) is reversed.",
      }));
      if (hasReceipt === false && !tx.flags.includes("MISSING_RECEIPT")) proposed.push(propose(ctx, { kind: "FLAG_MISSING_RECEIPT", description: `Flag ${tx.id} as missing a receipt`, reason: "No receipt is linked and the requester confirmed none is available.", targetIds: [tx.id], payload: { transactionId: tx.id } }));
    }
    const risks: string[] = [];
    if (personal) risks.push("Possible personal or mixed-use spend: business purpose and attendees must be documented or it is categorized to 7990 Non-Deductible / Personal (Review).");
    if (result.flags.includes("MISSING_RECEIPT")) risks.push("No receipt on file; the expense documentation policy requires support.");
    if (result.flags.includes("LARGE_UNUSUAL")) risks.push("Large or unusual amount; capitalization and approval thresholds apply.");
    if (result.flags.includes("NEW_MERCHANT")) risks.push("New merchant with no approved history.");
    const escalation = result.escalation === "CANNOT_CLASSIFY" ? esc("CANNOT_CLASSIFY", result.reason, { missingItems: ["counterparty / business purpose"] }) : undefined;
    const label = result.accountCode ? accountName(ctx, result.accountCode) : "no category";
    return ok({
      answer: result.flags.includes("TRANSFER") ? `This looks like a transfer between company accounts, not an expense; it should be matched to its counterpart (${result.reason}).` : result.accountCode ? `Suggested category: ${label} (confidence ${result.confidence}${result.flags.length ? `; flags: ${result.flags.join(", ")}` : ""}). ${result.reason}` : `I can't categorize this one: ${result.reason}`,
      numbers: [textFigure("Suggested account", result.accountCode ?? "none"), textFigure("Confidence", result.confidence), ...(amountStr ? [moneyFigure("Amount", amountStr)] : [])],
      why: [result.reason, `Merchant normalized as "${result.merchantNormalized}"${result.vendorId ? ` (vendor ${result.vendorId})` : " (no vendor match)"}.`, `Rule: ${result.rule}.`],
      risks,
      recommendation: escalation ? "Provide the payee and business purpose, or mark it personal, so it can leave the exception queue." : personal ? "Confirm the business purpose (who, why) before approving; otherwise it goes to 7990 for CPA review." : proposed.length ? "Approve the categorization or choose a different account." : "Use this suggestion when recording the transaction.",
      escalation,
      educationKey: personal ? "personal_business_separation" : undefined,
      confidence: result.confidence,
      sourceRefs,
      structured: { value: result.accountCode, category: { accountCode: result.accountCode, accountId: result.accountId, confidence: result.confidence, status: result.status, flags: result.flags, reason: result.reason, rule: result.rule, merchantNormalized: result.merchantNormalized, vendorId: result.vendorId, recurringApproved: result.recurringApproved }, transactionId: tx?.id ?? null },
    }, { proposedActions: proposed, sourceIds: tx ? [tx.id, ...tx.documentIds] : [] });
  },
});

export const detectDuplicatesTool = defineTool({
  name: "detect_duplicates",
  description: "Find duplicate transactions (same merchant + amount within a window) and subscriptions charged twice in a month.",
  riskLevel: "GREEN",
  capabilityKey: "duplicate_detection",
  inputSchema: TASKS["accounting.detect_duplicates"].params,
  async execute(input, ctx) {
    const dupes = detectDuplicates(ctx.dataset, { windowDays: input.windowDays, transactionIds: input.transactionIds });
    const total = dupes.reduce((acc, d) => acc.plus(D(abs(d.amount))), D(0)).toFixed(4);
    return ok({
      answer: dupes.length ? `Found ${dupes.length} possible duplicate(s) totaling ${total}: ${dupes.slice(0, 5).map((d) => `${d.merchant} ${d.amount} (${d.daysApart}d apart, ${d.kind.toLowerCase().replace(/_/g, " ")})`).join("; ")}.` : "No duplicate transactions detected in the window.",
      numbers: [textFigure("Possible duplicates", dupes.length), moneyFigure("Amount at stake", total)],
      why: dupes.slice(0, 10).map((d) => `${d.transactionId} duplicates ${d.duplicateOfId}: same normalized merchant "${d.merchant}" and amount ${d.amount}, ${d.daysApart} day(s) apart (confidence ${d.confidence}).`),
      risks: dupes.length ? ["Duplicates overstate expenses and may indicate a double charge to dispute with the merchant."] : [],
      recommendation: dupes.length ? "Confirm with the merchant/card statement; mark confirmed duplicates so they are excluded from the ledger." : "Nothing to do.",
      confidence: 0.85,
      structured: { value: dupes.length, values: { duplicateCount: dupes.length, count: dupes.length, amountAtStake: total }, duplicates: dupes },
    }, { sourceIds: dupes.flatMap((d) => [d.transactionId, d.duplicateOfId]) });
  },
});

export const matchTransfersTool = defineTool({
  name: "match_transfers",
  description: "Pair opposite-signed transfers between company accounts within a 3-day window.",
  riskLevel: "GREEN",
  capabilityKey: "transfer_matching",
  inputSchema: TASKS["accounting.match_transfers"].params,
  async execute(input, ctx) {
    const { pairs, unmatched } = matchTransfers(ctx.dataset, { from: input.from, to: input.to });
    const total = pairs.reduce((acc, p) => acc.plus(D(p.amount)), D(0)).toFixed(4);
    return ok({
      answer: `${pairs.length} transfer pair(s) matched (${total}); ${unmatched.length} transfer-like transaction(s) remain unmatched.`,
      numbers: [textFigure("Matched pairs", pairs.length), moneyFigure("Matched amount", total), textFigure("Unmatched", unmatched.length)],
      why: pairs.slice(0, 10).map((p) => `${p.outTransactionId} → ${p.inTransactionId}: ${p.amount}, ${p.daysApart} day(s) apart.`),
      risks: unmatched.length ? ["Unmatched transfers may be miscategorized as expenses or income; each needs its counterpart or a categorization."] : [],
      confidence: 0.85,
      structured: { value: pairs.length, values: { matchedPairs: pairs.length, matchedAmount: total, unmatched: unmatched.length }, pairs, unmatched },
    }, { sourceIds: pairs.flatMap((p) => [p.outTransactionId, p.inTransactionId]) });
  },
});

export const exceptionQueueTool = defineTool({
  name: "exception_queue",
  description: "Transactions needing human review: uncategorized, flagged, low-confidence or in suspense.",
  riskLevel: "GREEN",
  capabilityKey: "transaction_categorization",
  inputSchema: TASKS["accounting.exception_queue"].params,
  async execute(input, ctx) {
    const items = exceptionQueue(ctx.dataset, input.asOf ?? ctx.asOfDate);
    const shown = items.slice(0, input.limit ?? 200);
    const priority = [...shown].sort((a, b) => Number(b.reasons.includes("uncategorized")) - Number(a.reasons.includes("uncategorized")) || b.flags.length - a.flags.length);
    const total = items.reduce((acc, i) => acc.plus(D(abs(i.amount))), D(0)).toFixed(4);
    const byReason: Record<string, number> = {};
    for (const i of items) for (const r of i.reasons) byReason[r] = (byReason[r] ?? 0) + 1;
    return ok({
      answer: items.length ? `${items.length} transaction(s) need review (${total} in total): ${Object.entries(byReason).map(([r, n]) => `${n} ${r}`).join(", ")}.` : "The exception queue is empty.",
      numbers: [textFigure("Items", items.length), moneyFigure("Amount in queue", total)],
      why: priority.slice(0, 15).map((i) => `${i.date} ${i.description} ${i.amount}: ${i.reasons.join(", ")}`),
      recommendation: items.length ? "Work the queue oldest-first; personal/mixed items go to 7990 pending review." : "Nothing to review.",
      confidence: 0.9,
      structured: { value: items.length, values: { count: items.length, exceptions: items.length, amount: total }, items: shown, exceptions: shown.map((i) => i.transactionId), byReason },
    }, { sourceIds: shown.map((i) => i.transactionId) });
  },
});

export const bookkeepingTools = [classifyTransactionTool, detectDuplicatesTool, matchTransfersTool, exceptionQueueTool];
