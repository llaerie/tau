import type Anthropic from "@anthropic-ai/sdk";
import { unresolvedAssumptions } from "../assumptions";
import type { Viewer } from "../auth/session";
import { formatAmount, formatCents, formatTotal, isKnown, type Amount, type Total } from "../finance/money";
import { evaluatePurchase, type ScenarioResult } from "../finance/scenario";
import type { Metric, WaterfallLine } from "../finance/types";
import { currentMonth } from "../ids";
import { buildCompanyView, buildHouseholdView, buildPersonalView, buildSpaceView, type PersonalView } from "../views";
import { scenarioBaseline } from "../views/scenario";

/**
 * Every number the assistant can talk about comes from these tools, which call
 * the same deterministic engine as the dashboards. The model only explains.
 */

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "get_company_summary",
    description: "Company cash, anticipated revenue, monthly commitments (employees, owner gross salaries, payroll costs, bills, overhead, tax reserve) and what is left for owner distributions. Includes which items are unknown.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "get_household_summary",
    description: "Household funding (each person's contribution plus planned company distributions), shared bills, shared goals in priority order, and the surplus or shortfall.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "get_personal_summary",
    description: "One person's gross salary, withholding, net take-home, obligations, goals in priority order and what is left for discretionary spending. Only spaces the current user may see are available.",
    input_schema: {
      type: "object",
      properties: { person: { type: "string", description: "Person's first name. Omit for the current user's own space." } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "evaluate_purchase",
    description: "Apply a proposed one-time or recurring purchase to a space and report the effect on cash, the reserve floor and each goal's funding and timeline. Deterministic.",
    input_schema: {
      type: "object",
      properties: {
        space: { type: "string", description: "\"company\", \"household\", or a person's first name for their personal space." },
        name: { type: "string" },
        amount_dollars: { type: "number" },
        kind: { type: "string", enum: ["one_time", "recurring"] },
        recurring_months: { type: "integer", description: "For recurring costs: how many months. Omit for ongoing." },
        start_month_offset: { type: "integer", description: "0 = this month." },
      },
      required: ["space", "name", "amount_dollars", "kind"],
      additionalProperties: false,
    },
  },
  {
    name: "list_unresolved_assumptions",
    description: "List the assumptions that are still unknown (tax rates, payroll classification, overhead, balances) and where to enter them.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: "summarize_ledger",
    description: "Actual cash flow recorded in the ledger for a space and month: income, spending, contributions, and what was excluded to avoid double counting.",
    input_schema: {
      type: "object",
      properties: {
        space: { type: "string", description: "\"company\", \"household\", or a person's first name." },
        month: { type: "string", description: "YYYY-MM. Defaults to the current month." },
      },
      required: ["space"],
      additionalProperties: false,
    },
  },
];

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  error?: string;
}

function metricJson(m: Metric) {
  return {
    label: m.label,
    value: formatTotal(m.total),
    known_cents: m.total.knownCents,
    complete: m.total.complete,
    unknown_items: m.total.unknowns,
    formula: m.provenance.formula,
    assumptions: m.provenance.assumptions,
    caveats: m.provenance.caveats,
  };
}

function lineJson(l: WaterfallLine) {
  return { label: l.label, kind: l.kind, amount: isKnown(l.amount) ? formatCents(l.amount.cents) : `unknown (${l.amount.reason})`, note: l.note ?? null };
}

function amountJson(a: Amount) {
  return isKnown(a) ? formatCents(a.cents) : `unknown (${a.reason})`;
}

function totalJson(t: Total) {
  return formatTotal(t);
}

function resolveSpaceId(viewer: Viewer, space: string): string {
  const key = space.trim().toLowerCase();
  if (key === "company" || key === "business") return viewer.spaces.find((s) => s.kind === "company")?.id ?? fail("You cannot see the company space.");
  if (key === "household" || key === "home" || key === "shared") return viewer.spaces.find((s) => s.kind === "household")?.id ?? fail("You cannot see the household space.");
  const name = key.replace(/^personal[:\s]*/, "").replace(/'s$/, "");
  if (!name || name === "me" || name === "mine" || name === "my") {
    return viewer.spaces.find((s) => s.kind === "personal" && s.personId === viewer.person?.id)?.id ?? fail("You do not have a personal space.");
  }
  const person = viewer.persons.find((p) => p.name.toLowerCase() === name || p.slug === name);
  const sp = person && viewer.spaces.find((s) => s.kind === "personal" && s.personId === person.id);
  if (!sp) return fail(`No visible space called "${space}". Personal spaces are private to their owner.`);
  return sp.id;
}

function fail(msg: string): never {
  throw new ToolError(msg);
}

export class ToolError extends Error {}

function personalJson(v: PersonalView) {
  return {
    person: v.personName,
    gross_salary: metricJson(v.result.gross),
    net_take_home: metricJson(v.result.net),
    obligations: metricJson(v.result.obligations),
    available_after_goals: metricJson(v.result.discretionary),
    upper_bound_if_nothing_withheld: v.result.discretionaryUpperBoundCents === null ? null : formatCents(v.result.discretionaryUpperBoundCents),
    goals_in_priority_order: v.result.goals?.allocations.map((g) => ({
      priority: g.priority,
      name: g.name,
      wanted: formatCents(g.wantedCents),
      funded: v.result.net.total.complete ? formatCents(g.fundedCents) : "unknown (net take-home unknown)",
      shortfall: v.result.net.total.complete ? formatCents(g.shortfallCents) : "unknown",
      months_to_target: g.monthsToTarget,
      rule: g.rule ?? null,
    })),
    waterfall: v.result.lines.map(lineJson),
    cash: metricJson(v.result.cash),
    unresolved: v.result.unresolved,
    ledger_evidence: v.observedNetLastMonthCents ? { last_month_net_deposits: formatCents(v.observedNetLastMonthCents), last_month_withheld: v.observedWithholdingLastMonthCents ? formatCents(v.observedWithholdingLastMonthCents) : null } : null,
  };
}

function scenarioJson(r: ScenarioResult, spaceLabel: string) {
  return {
    space: spaceLabel,
    purchase: { ...r.purchase, amount: formatCents(r.purchase.amountCents) },
    verdict: r.verdict,
    monthly_cost: formatCents(r.monthlyCostCents),
    total_cost: r.totalCostCents === null ? "ongoing" : formatCents(r.totalCostCents),
    lowest_cash_before: r.minCashBeforeCents === null ? "unknown" : formatCents(r.minCashBeforeCents),
    lowest_cash_after: r.minCashAfterCents === null ? "unknown" : formatCents(r.minCashAfterCents),
    ending_cash_change: r.endingCashDeltaCents === null ? "unknown" : formatCents(r.endingCashDeltaCents, { signed: true }),
    breaches_cash_floor: r.breachesFloor,
    first_negative_month: r.after.projection.firstNegativeMonth,
    goal_impacts: r.goalImpacts.map((g) => ({ priority: g.priority, name: g.name, funded_before: formatCents(g.fundedBeforeCents), funded_after: formatCents(g.fundedAfterCents), delay_months: g.delayMonths === Infinity ? "never reaches target" : g.delayMonths })),
    notes: r.notes,
    assumptions: r.assumptions,
    unknown_inputs: r.after.projection.unknowns,
  };
}

export function executeTool(viewer: Viewer, name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case "get_company_summary": {
      const v = buildCompanyView(viewer);
      const r = v.result;
      return {
        space: v.space.name,
        cash: metricJson(r.cash),
        revenue: metricJson(r.revenue),
        committed: metricJson(r.committed),
        available_for_household: metricJson(r.distributable),
        reserve_target: metricJson(r.reserveTarget),
        runway_months_on_known_costs: r.runwayMonths,
        waterfall: r.lines.map(lineJson),
        unpaid_bills_this_month: formatCents(v.unpaidCommittedCents),
        employee_classification: viewer.assumptions.company.employeeClassification,
        unresolved: r.unresolved,
      };
    }
    case "get_household_summary": {
      const v = buildHouseholdView(viewer);
      const r = v.result;
      return {
        funding: metricJson(r.funding),
        shared_bills: metricJson(r.bills),
        surplus_or_shortfall: metricJson(r.surplus),
        cash: metricJson(r.cash),
        contribution_split: r.contributionSplit?.map((c) => ({ name: c.name, amount: formatCents(c.amountCents), share_percent: c.shareBps / 100 })) ?? "unknown (a contribution is not set)",
        goals_in_priority_order: r.goals.allocations.map((g) => ({ priority: g.priority, name: g.name, wanted: formatCents(g.wantedCents), funded: formatCents(g.fundedCents), months_to_target: g.monthsToTarget })),
        waterfall: r.lines.map(lineJson),
        unresolved: r.unresolved,
      };
    }
    case "get_personal_summary": {
      const person = typeof input.person === "string" && input.person.trim() ? input.person : "me";
      const spaceId = resolveSpaceId(viewer, person);
      return personalJson(buildPersonalView(viewer, spaceId));
    }
    case "evaluate_purchase": {
      const spaceId = resolveSpaceId(viewer, String(input.space ?? "me"));
      const amount = Number(input.amount_dollars);
      if (!Number.isFinite(amount) || amount <= 0) fail("amount_dollars must be a positive number.");
      const kind = input.kind === "recurring" ? "recurring" : "one_time";
      const view = buildSpaceView(viewer, spaceId);
      const baseline = scenarioBaseline(view);
      const r = evaluatePurchase(baseline, {
        name: String(input.name ?? "Proposed purchase"),
        amountCents: Math.round(amount * 100),
        kind,
        recurringMonths: kind === "recurring" && Number.isInteger(input.recurring_months) ? Number(input.recurring_months) : null,
        startMonthOffset: Number.isInteger(input.start_month_offset) ? Math.max(0, Number(input.start_month_offset)) : 0,
      });
      return scenarioJson(r, baseline.spaceLabel);
    }
    case "list_unresolved_assumptions": {
      const names = Object.fromEntries(viewer.persons.map((p) => [p.id, p.name]));
      return unresolvedAssumptions(viewer.assumptions, names)
        .filter((u) => !viewer.persons.some((p) => u.key.startsWith(`${p.id}-`) && !u.key.endsWith("-contribution") && !viewer.spaces.some((s) => s.personId === p.id)))
        .map((u) => ({ item: u.label, where: u.where }));
    }
    case "summarize_ledger": {
      const spaceId = resolveSpaceId(viewer, String(input.space ?? "me"));
      const month = typeof input.month === "string" && /^\d{4}-\d{2}$/.test(input.month) ? input.month : currentMonth();
      const v = buildSpaceView(viewer, spaceId);
      const view = v.month === month ? v : buildSpaceView(viewer, spaceId, month);
      const f = view.flows;
      return {
        space: view.space.name,
        month,
        income: formatCents(f.incomeCents),
        spending: formatCents(f.spendingCents),
        contributions_in: formatCents(f.contributionsInCents),
        contributions_out: formatCents(f.contributionsOutCents),
        net_cash_flow: formatCents(f.netCashFlowCents, { signed: true }),
        moved_to_savings_not_spending: formatCents(f.savingsAllocatedCents),
        excluded_to_avoid_double_counting: { card_payments: formatCents(f.excluded.ccPaymentsCents), transfers_between_own_accounts: formatCents(f.excluded.internalTransfersCents), payroll_withholding_informational: formatCents(f.withholdingCents) },
        transactions: f.transactionCount,
        unpaid_bills_still_due: formatCents(view.unpaidCommittedCents),
        cash_now: amountJson(view.cash),
        cash_known_so_far: totalJson(view.cashTotal),
      };
    }
    default:
      fail(`Unknown tool ${name}`);
  }
}

export { formatAmount };
