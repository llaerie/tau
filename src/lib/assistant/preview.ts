import type { Viewer } from "../auth/session";
import { executeTool, ToolError, type ToolCall } from "./tools";

/**
 * Deterministic preview used when no model is connected. It routes the
 * question to the same tools Claude would use and renders their output with
 * fixed templates. It never guesses a number.
 */
export function previewRouter(viewer: Viewer, message: string): { toolCalls: ToolCall[]; text: string } {
  const q = message.toLowerCase();
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const personNames = viewer.persons.map((p) => p.name.toLowerCase());
  const mentionedPerson = personNames.find((n) => q.includes(n));

  const money = q.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(k)?/);
  const wantsPurchase = /\b(afford|buy|purchase|spend on|cost|lease|subscription|hire|upgrade|what if)\b/.test(q) && money;
  if (wantsPurchase) {
    const raw = money[1].replace(/,/g, "");
    const amount = Number(raw) * (money[2] ? 1000 : 1);
    const recurring = /\b(a month|per month|monthly|\/mo|each month|every month|subscription|lease|salary|hire)\b/.test(q);
    const space = /\b(company|business)\b/.test(q) ? "company" : /\b(household|home|rent|shared|joint)\b/.test(q) ? "household" : mentionedPerson ?? "me";
    const name = message.replace(/[.?!]+$/, "").slice(0, 60);
    calls.push({ name: "evaluate_purchase", input: { space, name, amount_dollars: amount, kind: recurring ? "recurring" : "one_time" } });
  } else {
    if (/\b(unknown|missing|assumption|unresolved|what do you need|not set)\b/.test(q)) calls.push({ name: "list_unresolved_assumptions", input: {} });
    if (/\b(spent|spending|transactions|ledger|cash flow|last month|this month|paid)\b/.test(q)) {
      const space = /\b(company|business)\b/.test(q) ? "company" : /\b(household|home|shared|joint)\b/.test(q) ? "household" : mentionedPerson ?? "me";
      const m = q.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
      calls.push({ name: "summarize_ledger", input: { space, ...(m ? { month: m[0] } : /last month/.test(q) ? { month: lastMonth() } : {}) } });
    }
    if (/\b(company|business|revenue|payroll|employee|runway|distribut|tax)\b/.test(q)) calls.push({ name: "get_company_summary", input: {} });
    if (/\b(household|home|rent|shared|joint)\b/.test(q)) calls.push({ name: "get_household_summary", input: {} });
    if (mentionedPerson || /\b(my|me|mine|personal|take-home|take home|net|travel|discretionary|left over|available)\b/.test(q)) calls.push({ name: "get_personal_summary", input: mentionedPerson ? { person: mentionedPerson } : {} });
    if (calls.length === 0) {
      calls.push({ name: "get_company_summary", input: {} }, { name: "get_household_summary", input: {} }, { name: "get_personal_summary", input: {} });
    }
  }

  const toolCalls: ToolCall[] = calls.map((c) => {
    try {
      return { name: c.name, input: c.input, result: executeTool(viewer, c.name, c.input) };
    } catch (err) {
      return { name: c.name, input: c.input, result: null, error: err instanceof ToolError ? err.message : "This tool could not run." };
    }
  });

  return { toolCalls, text: renderPreview(toolCalls) };
}

function lastMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

type Rec = Record<string, unknown>;
const metricLine = (m: Rec) => `${m.label}: ${m.value}${(m.unknown_items as string[]).length ? ` (unknown: ${(m.unknown_items as string[]).join("; ")})` : ""}`;

export function renderPreview(calls: ToolCall[]): string {
  const parts: string[] = [];
  for (const c of calls) {
    if (c.error) {
      parts.push(`I could not run ${c.name.replace(/_/g, " ")}: ${c.error}`);
      continue;
    }
    const r = c.result as Rec;
    switch (c.name) {
      case "get_company_summary": {
        const lines = [
          `**Company (${r.space})**`,
          metricLine(r.cash as Rec),
          `${metricLine(r.revenue as Rec)}. This is company money, not take-home pay.`,
          metricLine(r.committed as Rec),
          `${metricLine(r.available_for_household as Rec)}${(r.available_for_household as Rec).complete ? "" : ". Treat it as an upper bound until the unknown items are entered"}.`,
          r.runway_months_on_known_costs !== null ? `Runway on known operating cost: ${r.runway_months_on_known_costs} months.` : "Runway cannot be computed while cash is unknown.",
          `${metricLine(r.retained_after_distributions as Rec)}.`,
          `Allocations: ${(r.allocations as Rec[]).map((a) => `${a.name} ${a.amount} (${String(a.kind).replace(/_/g, " ")})`).join("; ")}.`,
        ];
        parts.push(lines.join("\n"));
        break;
      }
      case "get_household_summary": {
        const goals = (r.goals_in_priority_order as Rec[]).map((g) => `${g.priority}. ${g.name}: wants ${g.wanted}, funded ${g.funded}`).join("; ");
        parts.push([`**Household**`, metricLine(r.funding as Rec), metricLine(r.shared_bills as Rec), metricLine(r.surplus_or_shortfall as Rec), goals ? `Goals in priority order: ${goals}.` : "", `${metricLine(r.cash as Rec)}.`].filter(Boolean).join("\n"));
        break;
      }
      case "get_personal_summary": {
        const goals = (r.goals_in_priority_order as Rec[] | undefined)?.map((g) => `${g.priority}. ${g.name}: wants ${g.wanted}, funded ${g.funded}${g.rule ? ` (${g.rule})` : ""}`).join("; ");
        const net = r.net_take_home as Rec;
        parts.push(
          [
            `**${r.person} (personal)**`,
            `${metricLine(r.gross_salary as Rec)}. Gross, not a spending allowance.`,
            metricLine(net),
            metricLine(r.obligations as Rec),
            goals ? `Goals in priority order: ${goals}.` : "",
            `${metricLine(r.available_after_goals as Rec)}${!net.complete && r.upper_bound_if_nothing_withheld ? `. Even with nothing withheld it would be at most ${r.upper_bound_if_nothing_withheld}` : ""}.`,
            (r.spending_plan as Rec[]).length ? `Spending plan: ${(r.spending_plan as Rec[]).map((b) => `${b.name} ${b.planned}${b.spent_this_month !== "not tracked" ? ` (spent ${b.spent_this_month})` : ""}`).join("; ")}. ${metricLine(r.unallocated_after_spending_plan as Rec)}.` : "",
            r.ledger_evidence ? `Ledger evidence: last month's net deposits were ${(r.ledger_evidence as Rec).last_month_net_deposits}${(r.ledger_evidence as Rec).last_month_withheld ? ` with ${(r.ledger_evidence as Rec).last_month_withheld} withheld` : ""}.` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        break;
      }
      case "evaluate_purchase": {
        const verdict = { affordable: "Affordable on known figures.", affordable_with_goal_cuts: "Affordable, but goals lose funding.", creates_shortfall: "This creates a shortfall.", unknown: "Cannot tell yet: some inputs are unknown." }[String(r.verdict)] ?? String(r.verdict);
        const p = r.purchase as Rec;
        parts.push(
          [
            `**Purchase scenario: ${p.name} (${p.amount} ${p.kind === "recurring" ? "a month" : "one time"}, ${r.space})**`,
            verdict,
            `Lowest cash before: ${r.lowest_cash_before}; after: ${r.lowest_cash_after}. Cash after six months changes by ${r.ending_cash_change}.`,
            ...(r.notes as string[]),
            `Assumptions: ${(r.assumptions as string[]).join(" ")}`,
          ].join("\n"),
        );
        break;
      }
      case "list_unresolved_assumptions": {
        const items = c.result as Rec[];
        parts.push(items.length ? `**Still unknown**\n${items.map((i) => `- ${i.item} (${i.where})`).join("\n")}` : "Every assumption has a value.");
        break;
      }
      case "summarize_ledger": {
        const ex = r.excluded_to_avoid_double_counting as Rec;
        parts.push(
          [
            `**Ledger, ${r.space}, ${r.month}**`,
            `Income ${r.income}, spending ${r.spending}, contributions in ${r.contributions_in}, contributions out ${r.contributions_out}; net cash flow ${r.net_cash_flow} across ${r.transactions} transactions.`,
            `Moved to savings (not spending): ${r.moved_to_savings_not_spending}. Excluded to avoid double counting: card payments ${ex.card_payments}, transfers between own accounts ${ex.transfers_between_own_accounts}, payroll withholding ${ex.payroll_withholding_informational}.`,
            `Bills still due this month: ${r.unpaid_bills_still_due}. Cash now: ${r.cash_known_so_far}.`,
          ].join("\n"),
        );
        break;
      }
    }
  }
  return parts.join("\n\n");
}
