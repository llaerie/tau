import { fundGoalsInPriorityOrder } from "./goals";
import {
  addTotals,
  formatAmount,
  formatCents,
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

export interface WithholdingInput {
  /** Employee FICA (Social Security + Medicare) as a percent of gross. Null = unknown. */
  ficaRatePct: number | null;
  /** Estimated federal + state income tax withheld per month. Null = unknown. */
  incomeTax: Amount;
  /** Optional range around the income-tax estimate, for the caveat. */
  incomeTaxRangeCents?: [number, number] | null;
}

export interface BudgetInput {
  id: string;
  name: string;
  monthly: Amount;
  /** Actual spending recorded against this budget in the period, when known. */
  actualCents?: number | null;
}

export interface PersonalInput {
  personId: string;
  name: string;
  /** GROSS salary from the company. */
  grossSalary: Amount;
  withholding: WithholdingInput;
  /** Other net income (side income, already net). */
  otherNetIncome: Amount;
  /** Planned monthly contribution to the household. */
  householdContribution: Amount;
  /** Fixed personal bills. */
  bills: BillInput[];
  /** Personal goals; priority 1 funded first. */
  goals: GoalInput[];
  /** Planned discretionary spending by category. */
  budgets: BudgetInput[];
  cashBalance: Amount;
  cashKnownSoFar?: Total;
  cashAsOf?: string | null;
}

export interface BudgetLine {
  id: string;
  name: string;
  plannedCents: number | null;
  actualCents: number | null;
  remainingCents: number | null;
}

export interface PersonalResult {
  lines: WaterfallLine[];
  gross: Metric;
  net: Metric;
  obligations: Metric;
  /** Money left for goals before any discretionary spending. */
  afterObligations: Total;
  goals: GoalFundingResult | null;
  /** Discretionary money after goals; negative = shortfall. */
  discretionary: Metric;
  /** Planned spending budgets and what is left unallocated after them. */
  budgets: BudgetLine[];
  plannedSpending: Total;
  unallocated: Metric;
  /** Discretionary upper bound if nothing were withheld. Only reported when net is unknown. */
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
    source: "Settings → People → Gross salary",
    note: "Gross, before withholding. Not a spending allowance.",
  });

  const fica = percentOf(input.grossSalary, input.withholding.ficaRatePct, "FICA rate not set");
  if (!isKnown(fica)) unresolved.push("Employee FICA rate (Social Security + Medicare)");
  push({
    id: "fica",
    label: "Social Security & Medicare (employee share)",
    kind: "outflow",
    amount: fica,
    source: "Settings → People → Withholding",
    note: isKnown(fica) ? `${input.withholding.ficaRatePct}% of gross` : "Unknown until a rate is entered.",
  });

  const incomeTax = input.withholding.incomeTax;
  if (!isKnown(incomeTax)) unresolved.push("Federal + state income-tax withholding estimate");
  const range = input.withholding.incomeTaxRangeCents;
  push({
    id: "income-tax",
    label: "Federal + state income tax withheld",
    kind: "outflow",
    amount: incomeTax,
    source: "Settings → People → Withholding",
    note: isKnown(incomeTax) ? `Estimate${range ? `; plausible range ${formatCents(range[0])}–${formatCents(range[1])}` : ""}. Payroll will set the exact amount.` : "Unknown until an estimate is entered. Net take-home stays unknown.",
  });

  const net: Total = running;
  push({ id: "other-income", label: "Other net income", kind: "inflow", amount: input.otherNetIncome, source: "Settings → People → Other income" });

  push({ id: "household", label: "Household contribution", kind: "outflow", amount: input.householdContribution, source: "Settings → Household → Contributions" });

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

  const goalsResult = fundGoalsInPriorityOrder(input.goals, afterObligations.complete ? afterObligations.knownCents : 0);
  const goalWanted = goalsResult.totalWantedCents;
  push({
    id: "goals",
    label: `Goals in priority order (${input.goals.length})`,
    kind: "outflow",
    amount: known(goalWanted),
    source: "Goals → personal",
    note: input.goals.slice().sort((a, b) => a.priority - b.priority).map((g) => `${g.priority}. ${g.name}`).join(" → ") || undefined,
  });

  const discretionary = running;
  lines.push({
    id: "discretionary",
    label: "Available for discretionary spending",
    kind: "subtotal",
    amount: discretionary.complete ? known(discretionary.knownCents) : unknown("net take-home unknown"),
    running: discretionary,
    source: "Computed",
  });

  const plannedSpending = sumAmounts(input.budgets.map((b) => b.monthly));
  push({
    id: "budgets",
    label: `Planned spending (${input.budgets.length} ${input.budgets.length === 1 ? "budget" : "budgets"})`,
    kind: "outflow",
    amount: plannedSpending.complete ? known(plannedSpending.knownCents) : unknown(`budgets without an amount: ${plannedSpending.unknowns.join("; ")}`),
    source: `Budgets → ${input.name}`,
    note: input.budgets.map((b) => `${b.name} ${formatAmount(b.monthly)}`).join(" · ") || "No spending plan yet.",
  });
  const unallocated = running;
  lines.push({
    id: "unallocated",
    label: unallocated.complete && unallocated.knownCents < 0 ? "Over-planned" : "Unallocated",
    kind: "result",
    amount: unallocated.complete ? known(unallocated.knownCents) : unknown("depends on unknown items"),
    running: unallocated,
    source: "Computed",
  });

  const budgetLines: BudgetLine[] = input.budgets.map((b) => {
    const planned = isKnown(b.monthly) ? b.monthly.cents : null;
    const actual = b.actualCents ?? null;
    return { id: b.id, name: b.name, plannedCents: planned, actualCents: actual, remainingCents: planned !== null && actual !== null ? planned - actual : null };
  });

  const upperBound = discretionary.complete
    ? null
    : (isKnown(input.grossSalary) ? input.grossSalary.cents : 0) + (isKnown(input.otherNetIncome) ? input.otherNetIncome.cents : 0) - obligations.knownCents - goalWanted;

  const withholdingAssumptions = [
    input.withholding.ficaRatePct === null ? "FICA rate is not set." : `Employee FICA at ${input.withholding.ficaRatePct}% of gross.`,
    isKnown(incomeTax) ? `Income tax withholding estimated at ${formatCents(incomeTax.cents)} per month${range ? ` (range ${formatCents(range[0])}–${formatCents(range[1])})` : ""}.` : "Income-tax withholding is not estimated; net take-home is unknown.",
  ];

  const metric = (id: string, label: string, t: Total, formula: string, inputs: Metric["provenance"]["inputs"], assumptions: string[], caveats: string[]): Metric => ({ id: `${input.personId}-${id}`, label, total: t, provenance: { formula, inputs, assumptions, caveats } });

  return {
    lines,
    gross: metric("gross", "Gross salary", totalOf(input.grossSalary), "as entered", [{ label: "Gross monthly salary", value: formatAmount(input.grossSalary), source: "Settings → People" }], [], ["Gross, before withholding. Not a spending allowance."]),
    net: metric(
      "net",
      "Net take-home",
      net,
      "gross − FICA − income tax withheld",
      [
        { label: "Gross", value: formatAmount(input.grossSalary), source: "Settings → People" },
        { label: "FICA", value: formatAmount(fica), source: "Settings → People → Withholding" },
        { label: "Income tax withheld", value: formatAmount(incomeTax), source: "Settings → People → Withholding" },
      ],
      withholdingAssumptions,
      net.complete
        ? range && isKnown(input.grossSalary) && isKnown(fica)
          ? [`With the range, net lands between ${formatCents(input.grossSalary.cents - fica.cents - range[1])} and ${formatCents(input.grossSalary.cents - fica.cents - range[0])}. Have payroll or a CPA set the exact withholding.`]
          : []
        : ["Unknown until withholding is entered. It is not assumed to be zero."],
    ),
    obligations: metric(
      "obligations",
      "Fixed obligations",
      obligations,
      "household contribution + fixed personal bills",
      [
        { label: "Household contribution", value: formatAmount(input.householdContribution), source: "Settings → Household" },
        { label: "Fixed bills", value: formatTotal(billsTotal), source: `Bills → ${input.name}` },
      ],
      [],
      [],
    ),
    afterObligations,
    goals: goalsResult,
    discretionary: metric(
      "discretionary",
      "Available after goals",
      discretionary,
      "net + other income − obligations − goals (priority order)",
      [
        { label: "Net take-home", value: formatTotal(net), source: "Computed" },
        { label: "Other net income", value: formatAmount(input.otherNetIncome), source: "Settings → People" },
        { label: "Obligations", value: formatTotal(obligations), source: "Computed" },
        { label: "Goals wanted", value: formatCents(goalWanted), source: "Goals" },
      ],
      [...withholdingAssumptions, "Goals are funded in priority order before any discretionary spending."],
      discretionary.complete
        ? discretionary.knownCents < 0
          ? [`Shortfall of ${formatCents(-discretionary.knownCents)}: obligations and goals exceed net income.`]
          : []
        : [`Unknown. Even if nothing were withheld, at most ${formatCents(upperBound ?? 0)} would remain.`],
    ),
    budgets: budgetLines,
    plannedSpending,
    unallocated: metric(
      "unallocated",
      unallocated.complete && unallocated.knownCents < 0 ? "Over-planned" : "Unallocated after spending plan",
      unallocated,
      "available after goals − planned spending budgets",
      [
        { label: "Available after goals", value: formatTotal(discretionary), source: "Computed" },
        { label: "Planned spending", value: formatTotal(plannedSpending), source: `Budgets → ${input.name}` },
      ],
      [],
      unallocated.complete && unallocated.knownCents < 0 ? [`The spending plan exceeds what is available by ${formatCents(-unallocated.knownCents)}.`] : [],
    ),
    discretionaryUpperBoundCents: upperBound,
    cash: metric(
      "cash",
      `${input.name}'s cash`,
      input.cashKnownSoFar ?? totalOf(input.cashBalance),
      "sum of personal account balances",
      [{ label: "Personal accounts", value: formatAmount(input.cashBalance), source: input.cashAsOf ? `Accounts (as of ${input.cashAsOf})` : "Accounts" }],
      [],
      isKnown(input.cashBalance) ? [] : ["At least one account has no balance entered."],
    ),
    unresolved,
  };
}
