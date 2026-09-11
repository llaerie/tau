import { fundGoalsInPriorityOrder } from "./goals";
import { addTotals, formatAmount, formatTotal, isKnown, known, monthlyEquivalent, sumAmounts, total, totalOf, unknown, type Amount, type Total } from "./money";
import type { BudgetInput, BudgetLine } from "./personal";
import type { BillInput, GoalFundingResult, GoalInput, Metric, WaterfallLine } from "./types";

export interface HouseholdContribution {
  personId: string;
  name: string;
  amount: Amount;
}

export interface HouseholdInput {
  contributions: HouseholdContribution[];
  /** Planned owner distributions from the company paid into the household. */
  companyDistribution: Amount;
  /** Household items the company pays for directly (household-kind allocations). */
  companyPaidItems: Amount;
  bills: BillInput[];
  goals: GoalInput[];
  /** Planned variable spending (groceries, dining together, ...). */
  budgets: BudgetInput[];
  cashBalance: Amount;
  /** When cash is partially unknown, the known portion and the list of unknown accounts. */
  cashKnownSoFar?: Total;
  cashAsOf?: string | null;
}

export interface HouseholdResult {
  lines: WaterfallLine[];
  funding: Metric;
  bills: Metric;
  goals: GoalFundingResult;
  budgets: BudgetLine[];
  plannedSpending: Total;
  surplus: Metric;
  cash: Metric;
  /** Each person's share of total funding, in basis points, when all contributions are known. */
  contributionSplit: { personId: string; name: string; amountCents: number; shareBps: number }[] | null;
  unresolved: string[];
}

export function computeHousehold(input: HouseholdInput): HouseholdResult {
  const lines: WaterfallLine[] = [];
  const unresolved: string[] = [];
  let running: Total = total(0);
  const push = (line: Omit<WaterfallLine, "running">) => {
    const delta = totalOf(line.amount);
    const signed = line.kind === "inflow" ? delta : { ...delta, knownCents: -delta.knownCents };
    if (line.kind !== "subtotal" && line.kind !== "result") running = addTotals(running, signed);
    lines.push({ ...line, running });
  };

  for (const c of input.contributions) {
    if (!isKnown(c.amount)) unresolved.push(`${c.name}'s household contribution`);
    push({ id: `contrib-${c.personId}`, label: `${c.name}'s contribution`, kind: "inflow", amount: c.amount, source: "Settings → Household → Contributions" });
  }
  push({
    id: "company-distribution",
    label: "Owner distributions from the company",
    kind: "inflow",
    amount: input.companyDistribution,
    source: "Settings → Household → Planned company distribution",
    note: "Only what is planned to be paid out. See Company for what is actually available.",
  });
  push({
    id: "company-paid-items",
    label: "Household items paid by the company",
    kind: "inflow",
    amount: input.companyPaidItems,
    source: "Settings → Company → Allocations (household kind)",
    note: "Earmarked allocations such as apartment furnishing. Treated as an owner distribution.",
  });
  const funding = running;

  const billsTotal = sumAmounts(input.bills.map((b) => monthlyEquivalent(b.amount, b.cadence)));
  push({
    id: "bills",
    label: `Shared bills (${input.bills.length})`,
    kind: "outflow",
    amount: billsTotal.complete ? known(billsTotal.knownCents) : unknown(`bills with unknown amounts: ${billsTotal.unknowns.join("; ")}`),
    source: "Bills → Household",
  });
  const afterBills = running;

  const goals = fundGoalsInPriorityOrder(input.goals, afterBills.complete ? afterBills.knownCents : 0);
  push({ id: "goals", label: `Shared goals (${input.goals.length})`, kind: "outflow", amount: known(goals.totalWantedCents), source: "Goals → Household" });

  const plannedSpending = sumAmounts(input.budgets.map((b) => b.monthly));
  push({
    id: "budgets",
    label: `Planned variable spending (${input.budgets.length})`,
    kind: "outflow",
    amount: plannedSpending.complete ? known(plannedSpending.knownCents) : unknown(`budgets without an amount: ${plannedSpending.unknowns.join("; ")}`),
    source: "Budgets → Household",
    note: input.budgets.map((b) => `${b.name} ${formatAmount(b.monthly)}`).join(" · ") || undefined,
  });
  const budgetLines: BudgetLine[] = input.budgets.map((b) => {
    const planned = isKnown(b.monthly) ? b.monthly.cents : null;
    const actual = b.actualCents ?? null;
    return { id: b.id, name: b.name, plannedCents: planned, actualCents: actual, remainingCents: planned !== null && actual !== null ? planned - actual : null };
  });

  const surplus = running;
  lines.push({
    id: "surplus",
    label: surplus.complete && surplus.knownCents < 0 ? "Household shortfall" : "Household surplus",
    kind: "result",
    amount: surplus.complete ? known(surplus.knownCents) : unknown("depends on unknown items"),
    running: surplus,
    source: "Computed",
  });

  const split = funding.complete && funding.knownCents > 0
    ? input.contributions.map((c) => ({
        personId: c.personId,
        name: c.name,
        amountCents: isKnown(c.amount) ? c.amount.cents : 0,
        shareBps: Math.round(((isKnown(c.amount) ? c.amount.cents : 0) * 10000) / funding.knownCents),
      }))
    : null;

  return {
    lines,
    funding: {
      id: "household-funding",
      label: "Household funding",
      total: funding,
      provenance: {
        formula: "personal contributions + planned company distribution + household items paid by the company",
        inputs: [
          ...input.contributions.map((c) => ({ label: `${c.name}'s contribution`, value: formatAmount(c.amount), source: "Settings → Household" })),
          { label: "Company distribution", value: formatAmount(input.companyDistribution), source: "Settings → Household" },
          { label: "Company-paid items", value: formatAmount(input.companyPaidItems), source: "Settings → Company → Allocations" },
        ],
        assumptions: ["Contributions are planned amounts; the ledger shows what was actually transferred."],
        caveats: funding.complete ? [] : ["At least one contribution is unknown."],
      },
    },
    bills: {
      id: "household-bills",
      label: "Shared bills",
      total: billsTotal,
      provenance: {
        formula: "sum of monthly-equivalent shared bills",
        inputs: input.bills.map((b) => ({ label: b.name, value: `${formatAmount(b.amount)} ${b.cadence}`, source: "Bills → Household" })),
        assumptions: [],
        caveats: [],
      },
    },
    goals,
    budgets: budgetLines,
    plannedSpending,
    surplus: {
      id: "household-surplus",
      label: surplus.complete && surplus.knownCents < 0 ? "Shortfall" : "Surplus",
      total: surplus,
      provenance: {
        formula: "funding − shared bills − shared goals − planned variable spending",
        inputs: [
          { label: "Funding", value: formatTotal(funding), source: "Computed" },
          { label: "Shared bills", value: formatTotal(billsTotal), source: "Bills" },
          { label: "Shared goals wanted", value: formatAmount(known(goals.totalWantedCents)), source: "Goals" },
          { label: "Planned variable spending", value: formatTotal(plannedSpending), source: "Budgets" },
        ],
        assumptions: [],
        caveats: surplus.complete && surplus.knownCents < 0 ? [`Shortfall of ${formatAmount(known(-surplus.knownCents))}. Assumptions were not changed to hide it.`] : [],
      },
    },
    cash: {
      id: "household-cash",
      label: "Household cash",
      total: input.cashKnownSoFar ?? totalOf(input.cashBalance),
      provenance: {
        formula: "sum of household account balances",
        inputs: [{ label: "Household accounts", value: formatAmount(input.cashBalance), source: input.cashAsOf ? `Accounts (as of ${input.cashAsOf})` : "Accounts" }],
        assumptions: [],
        caveats: isKnown(input.cashBalance) ? [] : ["At least one account has no balance entered."],
      },
    },
    contributionSplit: split,
    unresolved,
  };
}
