import type { Viewer } from "../auth/session";
import { formatCents } from "../finance/money";
import type { AssistantEnvelope, NextAction } from "./envelope";
import { executeTool, ToolError, type ToolCall } from "./tools";

/**
 * Deterministic preview used when no model is connected. Routes the question
 * to the same tools Claude would call and renders their results with fixed
 * wording. It never guesses a number and is always labelled a preview.
 */
export interface PreviewResult {
  calls: ToolCall[];
  text: string;
  summary: string;
  nextAction?: NextAction;
}

export function previewRouter(viewer: Viewer, message: string, scope: "me" | "company" | "household"): PreviewResult {
  const q = message.toLowerCase();
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const money = q.match(/\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:dollars|bucks)/);
  const amount = money ? Number((money[1] ?? money[2]).replace(/,/g, "")) : null;
  const partnerName = viewer.persons.find((p) => p.id !== viewer.person?.id)?.name.toLowerCase();
  const mentionsPartner = !!partnerName && q.includes(partnerName);
  const wantsCompany = /\b(company|business|receipts?|revenue|payroll|runway|cash)\b/.test(q) && !/\bmy\b/.test(q);
  const sc = scope === "me" && wantsCompany ? "company" : scope;

  // Starter prompts without figures: ask for the missing details instead of guessing.
  if (amount === null && /\b(receipt|record|log)\b/.test(q) && !/\bplan\b/.test(q)) {
    const text = "Tell me the amount, what it was for and the date (today if you leave it out), for example “record $42.50 dinner, split with " + (partnerName ? partnerName[0].toUpperCase() + partnerName.slice(1) : "my partner") + "”. Or upload the receipt under Documents and I will read the total from a digital receipt. Nothing is saved until you approve the preview.";
    return { calls: [], text, summary: "Ready to record a receipt once you give me the amount.", nextAction: { label: "Upload a receipt", kind: "open_route", href: "/documents" } };
  }
  if (amount === null && !mentionsPartner && /\b(plan|buy|purchase)\b/.test(q) && !/\b(did|bought|spent|food|subscription)\b/.test(q)) {
    const text = "Tell me what you want to buy, the price if you know it, and roughly when, for example “plan a $1,200 Mac mini for the company next month”. I will check it against recorded cash and known commitments and prepare a dated plan for approval. No order is placed and nothing is paid.";
    return { calls: [], text, summary: "Ready to plan a purchase once you name the item and price.", nextAction: { label: "See planned purchases", kind: "open_route", href: "/money?space=company#plans" } };
  }

  if (/\b(set|change|make)\b.*\b(food|grocer|eating)\b.*budget|\bfood (budget|target)\b.*\b(to|at)\b/.test(q) && amount !== null) {
    calls.push({ name: "draft_budget_change", input: { field: "foodTarget", amount_dollars: amount } });
  } else if (/\b(receipt|record|log|add)\b/.test(q) && amount !== null && !/\bplan\b/.test(q) && (/\b(receipt|record|log)\b/.test(q) || !PURCHASE_NOUN.test(q))) {
    calls.push({ name: "draft_expense", input: { amount_dollars: amount, description: describe(message), split_equally_with_partner: /\bsplit\b/.test(q), scope: /\bpaid by the company\b|\bcompany\b/.test(q) ? "company" : "me", purpose: /\bcompany\b/.test(q) ? "personal" : "personal", beneficiary: /\bsofa|furniture|apartment|rent\b/.test(q) ? "household" : undefined } });
  } else if (/\b(sofa|furniture|computer|laptop|mac|hardware|buy|purchase|afford|plan)\b/.test(q) && amount !== null) {
    const monthOffset = /\bnext month\b/.test(q) ? 1 : 0;
    const scopeForPurchase = /\bcompany\b/.test(q) ? "company" : sc;
    calls.push({ name: "evaluate_purchase", input: { scope: scopeForPurchase, amount_dollars: amount, name: describe(message), recurring: /\b(a month|per month|monthly|subscription)\b/.test(q), month_offset: monthOffset, purpose: /\bsofa|furniture|apartment\b/.test(q) ? "personal" : /\bcomputer|laptop|mac\b/.test(q) ? "unresolved" : "unresolved" } });
    if (/\b(add|plan|record)\b/.test(q)) calls.push({ name: "draft_purchase_plan", input: { name: describe(message), amount_dollars: amount, scope: scopeForPurchase, category: /\bsofa|furniture\b/.test(q) ? "furniture" : /\bcomputer|laptop|mac\b/.test(q) ? "hardware" : "other", target_month: monthOffset ? nextMonth() : undefined, beneficiary: /\bsofa|furniture|apartment\b/.test(q) ? "household" : undefined, purpose: /\bsofa|furniture|apartment\b/.test(q) ? "personal" : "unresolved" } });
  } else if (mentionsPartner && /\b(purchases?|purchased|buy|buys|bought|spend|spends|spent|spending|transactions?|receipts?)\b/.test(q)) {
    calls.push({ name: "get_partner_summary", input: {} });
  } else if (/\b(ai tools?|subscriptions?|claude|chatgpt|openai|anthropic|api)\b/.test(q)) {
    calls.push({ name: "get_subscription_plan", input: {} });
  } else if (/\b(food|eat|grocer|meals?|lunch|dinner)\b/.test(q) || (sc === "me" && /\b(spend|afford|available|left)\b/.test(q))) {
    calls.push({ name: "get_personal_food_plan", input: {} });
  } else if (/\b(upcoming|due|obligations?|bills?|payments? (due|coming))\b/.test(q)) {
    calls.push({ name: "get_upcoming_obligations", input: { scope: sc, horizon_days: 30 } });
  } else if (/\b(unknown|missing|review|setup|set up|what do you need)\b/.test(q)) {
    calls.push({ name: "get_review_items", input: {} });
  } else if (/\b(delayed|late|didn'?t arrive|not received|payment (is )?late)\b/.test(q)) {
    calls.push({ name: "get_money_summary", input: { scope: "company" } }, { name: "get_upcoming_obligations", input: { scope: "company", horizon_days: 30 } });
  } else if (/\b(transactions?|spent|spending|ledger)\b/.test(q)) {
    calls.push({ name: "search_transactions", input: { scope: sc } });
  } else if (/\b(explain|where does|how did you|source)\b/.test(q)) {
    calls.push({ name: "explain_metric", input: { metric_id: sc === "company" ? "partial-remainder" : `${viewer.person?.id}-take-home` } });
  } else {
    calls.push({ name: "get_money_summary", input: { scope: sc } });
  }

  const toolCalls: ToolCall[] = calls.map((c) => {
    try {
      const r = executeTool(viewer, c.name, c.input);
      return { name: c.name, input: c.input, result: r.result, component: r.component, draft: r.draft };
    } catch (err) {
      return { name: c.name, input: c.input, result: null, error: err instanceof ToolError ? err.message : err instanceof Error && err.name === "AuthorizationError" ? err.message : "This tool could not run." };
    }
  });
  const text = renderPreview(toolCalls);
  return { calls: toolCalls, text, summary: text.split("\n")[0] };
}

function describe(message: string): string {
  return message
    .replace(/[.?!]+$/, "")
    .replace(/\$\s?[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:dollars|bucks)/gi, "")
    .replace(/,?\s*\b(split|shared?)\b.*$/i, "")
    .replace(/\b(paid|funded) (by|from) (the )?(company|household|business)\b/gi, "")
    .replace(/\bfor the (company|household|business)\b/gi, "")
    .replace(/\b(can you|could you|please|add|record|log|set|plan|a|an|the|receipt|for|expense)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Expense";
}

function nextMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
}

const PURCHASE_NOUN = /\b(sofa|couch|furniture|computer|laptop|mac|desk|chair|hardware|monitor|phone|camera)\b/;

type Rec = Record<string, unknown>;

function totalText(t: unknown): string {
  const x = t as { complete?: boolean; knownCents?: number } | null;
  if (!x || typeof x.knownCents !== "number") return "unknown";
  return x.complete ? formatCents(x.knownCents) : x.knownCents === 0 ? "unknown" : `${formatCents(x.knownCents)} so far`;
}

export function renderPreview(calls: ToolCall[]): string {
  const parts: string[] = [];
  for (const c of calls) {
    if (c.error) {
      parts.push(`I could not run ${c.name.replace(/_/g, " ")}: ${c.error}`);
      continue;
    }
    const r = c.result as Rec;
    switch (c.name) {
      case "get_personal_food_plan": {
        const target = r.foodTarget as number | null;
        const spent = r.foodSpent as number;
        const status = r.takeHomeStatus as string;
        const gross = (r.gross as { cents?: number })?.cents;
        const lines = [
          target === null ? `You have no food target yet. You have spent ${formatCents(spent)} on food this month.` : `Food: ${formatCents(spent)} spent of a ${formatCents(target)} target; ${formatCents((r.foodRemaining as number) ?? 0)} left this month.`,
          gross ? `Your ${formatCents(gross)} gross salary is not spendable cash; ` : "",
          status === "verified" ? `take-home is ${totalText(r.takeHome)} per payroll.` : status === "estimate" ? `take-home is estimated at ${totalText(r.takeHome)} (not a verified paycheck).` : `take-home is ${totalText(r.beforeIncomeTax)} before income tax, which is not yet confirmed, so I cannot give an exact available-to-spend amount.`,
          target === null ? "Next step: set a food target. I can prepare that for your approval." : "",
        ];
        parts.push(lines.filter(Boolean).join(" ").replace(/;\s+take-home/, "; take-home"));
        break;
      }
      case "get_money_summary": {
        if (r.scope === "company") {
          parts.push(`Company: recorded cash ${totalText(r.recordedCash)}${r.cashAsOf ? ` as of ${r.cashAsOf}` : ""} (recorded, not reconciled). Expected receipts ${totalText(r.expectedReceipts)}, received this month ${totalText(r.receivedThisMonth)}. Known monthly commitments ${totalText(r.knownCommitments)}; that leaves a partial remainder of ${totalText(r.partialRemainder)} before ${(r.unknownCosts as string[]).join("; ").toLowerCase()}. That remainder is not profit, not a balance and not safe to spend.`);
        } else if (r.scope === "household") {
          parts.push(`Household: the company pays ${totalText(r.companyPaidBills)} of shared bills each month (a benefit, not joint-account cash). Bills paid from the joint account: ${totalText(r.ownBills)}. Joint account cash ${totalText(r.jointCash)}; groceries so far ${formatCents(r.groceriesThisMonth as number)}.`);
        } else {
          parts.push(`Take-home ${r.takeHomeStatus === "incomplete" ? "is incomplete" : `is ${totalText(r.takeHome)} (${r.takeHomeStatus})`}; food target ${r.foodTarget === null ? "not set" : formatCents(r.foodTarget as number)}; food spent ${formatCents(r.foodSpent as number)}; unallocated plan ${totalText(r.unallocated)}.`);
        }
        break;
      }
      case "evaluate_purchase": {
        const verdict = { affordable: r.conditional ? "conditionally affordable" : "affordable on known figures", affordable_with_goal_cuts: "affordable but the plan slips", creates_shortfall: "a shortfall", unknown: "not decidable yet" }[String(r.verdict)] ?? String(r.verdict);
        const missing = r.missing as string[];
        parts.push(`${r.scope}: this is ${verdict}. ${(r.notes as string[]).join(" ")}${missing.length ? ` Still unknown: ${missing.join("; ")}.` : ""}${r.conditional ? " I can prepare a purchase plan for review; nothing would be paid." : ""}`);
        break;
      }
      case "get_subscription_plan": {
        const subs = r.subscriptions as Rec[];
        parts.push(`AI tools: ${subs.map((x) => `${x.provider} ${x.product} × ${x.quantity} (${x.tier}, ${x.status}, ${x.monthly === "unknown" ? "price unconfirmed" : `${x.monthly}/month`})`).join("; ")}. Confirmed monthly total ${totalText(r.knownMonthlyTotal)}${r.apiUsageLastMonth != null ? `; API usage last month ${formatCents(r.apiUsageLastMonth as number)}, tracked separately` : ""}.`);
        break;
      }
      case "get_partner_summary": {
        const shared = r.shared as boolean;
        parts.push(shared ? `${r.name}: food is ${String(r.foodStatus).replace("_", " ")}, take-home ${String(r.takeHomeStatus)}${r.savingsAllocationRoundedCents ? `, savings allocation about ${formatCents(r.savingsAllocationRoundedCents as number)}` : ""}. Individual purchases are private and are not available to you or to me.` : `${r.name} has not shared a personal summary. Individual purchases are private.`);
        break;
      }
      case "get_upcoming_obligations": {
        const items = r as unknown as Rec[];
        parts.push(items.length ? `Upcoming: ${items.map((o) => `${o.label} on ${o.dueDate}${(o.amount as { cents?: number }).cents !== undefined ? ` (${formatCents((o.amount as { cents: number }).cents)})` : " (amount unknown)"}${o.paid ? ", paid" : ""}`).join("; ")}.` : "Nothing is due in this window.");
        break;
      }
      case "get_review_items": {
        const items = r as unknown as Rec[];
        parts.push(items.length ? `Still to set up: ${items.map((i) => `${i.label} (${i.blocks})`).join(" ")}` : "Nothing is waiting for setup.");
        break;
      }
      case "search_transactions": {
        const rows = r as unknown as Rec[];
        parts.push(rows.length ? `${rows.length} transactions found; the list is below.` : "No transactions match.");
        break;
      }
      case "explain_metric": {
        parts.push(`${(r as Rec).label}: ${(r as Rec & { provenance: { formula: string } }).provenance.formula}. Inputs and assumptions are listed below.`);
        break;
      }
      case "draft_budget_change":
      case "draft_expense":
      case "draft_purchase_plan":
      case "draft_subscription_change": {
        const p = (r as Rec).preview as { title: string; summary: string; warnings: string[] };
        parts.push(`Prepared: ${p.title}. ${p.summary}${p.warnings.length ? ` ${p.warnings.join(" ")}` : ""} Approve it below to save it; nothing is saved until you do.`);
        break;
      }
      case "get_briefing":
        parts.push("Here is your briefing.");
        break;
    }
  }
  return parts.join("\n\n") || "I could not work out what to look up. Try asking about food, cash, upcoming payments, a purchase, or subscriptions.";
}

export function toEnvelope(viewer: Viewer, calls: ToolCall[], text: string, summary: string, mode: "claude" | "preview", scope: "me" | "company" | "household", fallbackNextAction?: NextAction): AssistantEnvelope {
  const components = calls.filter((c) => c.component).map((c) => c.component!);
  const drafts = calls.filter((c) => c.draft).map((c) => ({ id: c.draft!.id, type: c.draft!.type, version: c.draft!.version }));
  const missing = [...new Set(components.flatMap((c) => c.missing ?? []))];
  const nextAction = drafts.length
    ? { label: "Review and approve", kind: "approve_action" as const, actionId: drafts[0].id }
    : calls.some((c) => c.name === "get_personal_food_plan" && (c.result as { foodTarget?: number | null } | null)?.foodTarget === null)
      ? { label: "Set a food target", kind: "set_food_target" as const }
      : fallbackNextAction ?? null;
  return { answerType: drafts.length ? "draft" : calls.length > 0 && calls.every((c) => c.error) ? "error" : mode === "preview" ? "preview" : "answer", mode, summary, text, scope, asOf: new Date().toISOString().slice(0, 10), components, missing, nextAction, evidence: calls.map((c) => ({ tool: c.name, input: c.input, error: c.error })), actionDrafts: drafts };
}

export { ToolError };
