import { fundGoalsInPriorityOrder } from "./goals";
import {
  addTotals,
  formatAmount,
  formatTotal,
  isKnown,
  known,
  monthlyEquivalent,
  percentOf,
  sumAmounts,
  total,
  totalOf,
  unknown,
  type Amount,
  type Total,
} from "./money";
import type { BillInput, GoalFundingResult, GoalInput, Metric, WaterfallLine } from "./types";

export interface PersonalInput {
  personId: string;
  name: string;
  /** GROSS salary from the company. */
  grossSalary: Amount;
  /** Estimated total withholding (income tax + employee FICA) in percent. Null = unknown. */
  withholdingRatePct: number | null;
  /** Other net income (side income, already net). */
  otherNetIncome: Amount;
  /** Planned monthly contribution to the household. */
  householdContribution: Amount;
  /** Fixed personal bills. */
  bills: BillInput[];
  /** Personal goals; priority 1 funded first. */
  goals: GoalInput[];
  cashBalance: Amount;
  /** When cash is partially unknown, the known portion and the list of unknown accounts. */
  cashKnownSoFar?: Total;
  cashAsOf?: string | null;
}

export interface PersonalResult {
  lines: WaterfallLine[];
  gross: Metric;
  net: Metric;
  obligations: Metric;
  /** Money left for goals before any discretionary spending. */
  afterObligations: Total;
  goals: GoalFundingResult | null;
  /** Discretionary money after goals; may be a shortfall (negative) when obligations exceed net. */
  discretionary: Metric;
  /** Discretionary upper bound if withholding were zero (net = gross). Only reported when net is unknown. */
  discretionaryUpperBoundCents: number | null;
  cash: Metric;
  unresolved: string[];
}

export function computePersonal(input: PersonalInput): PersonalResult {
  const lines: WaterfallLine[] = [];
  const unresolved: string[] = [];
  let running: Total = total(0);
  const push = (line: Omit<WaterfallLine, "running">) => {
    const delta = totalOf(line.amount);
    const signed = line.kind === "inflow" ? delta : { ...delta, knownCents: -delta.knownCents };
    if (line.kind !== "subtotal" && line.kind !== "result") running = addTotals(running, signed);
    lines.push({ ...line, running });
  };

  push({
    id: "gross",
    label: "Gross salary from the company",
    kind: "inflow",
    amount: input.grossSalary,
    source: "Settings → Owners → Gross salary",
    note: "Gross, before withholding. Not a spending allowance.",
  });

  const withholding = percentOf(input.grossSalary, input.withholdingRatePct, "Withholding rate not set");
  if (!isKnown(withholding)) unresolved.push("Payroll withholding rate (income tax + employee FICA)");
  push({
    id: "withholding",
    label: "Payroll withholding",
    kind: "outflow",
    amount: withholding,
    source: "Settings → Owners → Withholding estimate",
    note: isKnown(withholding) ? `${input.withholdingRatePct}% of gross (estimate)` : "Unknown until an estimate is entered. Net take-home stays unknown.",
  });

  const net: Total = running;
  push({
    id: "other-income",
    label: "Other net income",
    kind: "inflow",
    amount: input.otherNetIncome,
    source: "Ledger / Settings → Owners → Other income",
  });

  push({
    id: "household",
    label: "Household contribution",
    kind: "outflow",
    amount: input.householdContribution,
    source: "Settings → Household → Contributions",
  });

  const billsTotal = sumAmounts(input.bills.map((b) => monthlyEquivalent(b.amount, b.cadence)));
  push({
    id: "bills",
    label: `Fixed personal bills (${input.bills.length})`,
    kind: "outflow",
    amount: billsTotal.complete ? known(billsTotal.knownCents) : unknown(`bills with unknown amounts: ${billsTotal.unknowns.join("; ")}`),
    source: `Bills → ${input.name}`,
  });

  const afterObligations = running;
  const obligations = addTotals(totalOf(input.householdContribution), billsTotal);

  // Goals are funded in priority order from what is left after obligations.
  // When net is unknown we cannot say how much reaches the goals, so we report
  // the wanted amounts and flag the result rather than pretending net = gross.
  const goalsResult = fundGoalsInPriorityOrder(input.goals, afterObligations.complete ? afterObligations.knownCents : 0);
  const goalWanted = goalsResult.totalWantedCents;
  push({
    id: "goals",
    label: `Goals in priority order (${input.goals.length})`,
    kind: "outflow",
    amount: known(goalWanted),
    source: "Goals → personal",
    note: input.goals
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((g) => `${g.priority}. ${g.name}`)
      .join(" → "),
  });

  const discretionary = running;
  lines.push({
    id: "discretionary",
    label: "Available for discretionary spending",
    kind: "result",
    amount: discretionary.complete ? known(discretionary.knownCents) : unknown("net take-home unknown"),
    running: discretionary,
    source: "Computed",
  });

  const upperBound = discretionary.complete
    ? null
    : (isKnown(input.grossSalary) ? input.grossSalary.cents : 0) +
      (isKnown(input.otherNetIncome) ? input.otherNetIncome.cents : 0) -
      obligations.knownCents -
      goalWanted;

  const withholdingAssumption =
    input.withholdingRatePct === null
      ? "Withholding rate is not set; net take-home is unknown."
      : `Withholding estimated at ${input.withholdingRatePct}% of gross.`;

  return {
    lines,
    gross: {
      id: `${input.personId}-gross`,
      label: "Gross salary",
      total: totalOf(input.grossSalary),
      provenance: {
        formula: "as entered",
        inputs: [{ label: "Gross monthly salary", value: formatAmount(input.grossSalary), source: "Settings → Owners" }],
        assumptions: [],
        caveats: ["Gross, before withholding. Not a spending allowance."],
      },
    },
    net: {
      id: `${input.personId}-net`,
      label: "Net take-home",
      total: net,
      provenance: {
        formula: "gross − withholding",
        inputs: [
          { label: "Gross", value: formatAmount(input.grossSalary), source: "Settings → Owners" },
          { label: "Withholding", value: formatAmount(withholding), source: "Settings → Owners → Withholding estimate" },
        ],
        assumptions: [withholdingAssumption],
        caveats: net.complete ? [] : ["Unknown until a withholding estimate is entered. It is not assumed to be zero."],
      },
    },
    obligations: {
      id: `${input.personId}-obligations`,
      label: "Fixed obligations",
      total: obligations,
      provenance: {
        formula: "household contribution + fixed personal bills",
        inputs: [
          { label: "Household contribution", value: formatAmount(input.householdContribution), source: "Settings → Household" },
          { label: "Fixed bills", value: formatTotal(billsTotal), source: `Bills → ${input.name}` },
        ],
        assumptions: [],
        caveats: [],
      },
    },
    afterObligations,
    goals: goalsResult,
    discretionary: {
      id: `${input.personId}-discretionary`,
      label: "Available after goals",
      total: discretionary,
      provenance: {
        formula: "net + other income − obligations − goals (priority order)",
        inputs: [
          { label: "Net take-home", value: formatTotal(net), source: "Computed" },
          { label: "Other net income", value: formatAmount(input.otherNetIncome), source: "Settings → Owners" },
          { label: "Obligations", value: formatTotal(obligations), source: "Computed" },
          { label: "Goals wanted", value: formatAmount(known(goalWanted)), source: "Goals" },
        ],
        assumptions: [withholdingAssumption, "Goals are funded in priority order before any discretionary spending."],
        caveats: discretionary.complete
          ? discretionary.knownCents < 0
            ? [`Shortfall of ${formatAmount(known(-discretionary.knownCents))}: obligations and goals exceed net income.`]
            : []
          : [`Unknown. Even if nothing were withheld, at most ${formatAmount(known(upperBound ?? 0))} would remain.`],
      },
    },
    discretionaryUpperBoundCents: upperBound,
    cash: {
      id: `${input.personId}-cash`,
      label: `${input.name}'s cash`,
      total: input.cashKnownSoFar ?? totalOf(input.cashBalance),
      provenance: {
        formula: "sum of personal account balances",
        inputs: [{ label: "Personal accounts", value: formatAmount(input.cashBalance), source: input.cashAsOf ? `Accounts (as of ${input.cashAsOf})` : "Accounts" }],
        assumptions: [],
        caveats: isKnown(input.cashBalance) ? [] : ["At least one account has no balance entered."],
      },
    },
    unresolved,
  };
}
