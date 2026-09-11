import {
  addTotals,
  formatAmount,
  formatTotal,
  isKnown,
  known,
  monthlyEquivalent,
  percentOf,
  percentOfTotal,
  sumAmounts,
  total,
  totalOf,
  unknown,
  type Amount,
  type Total,
} from "./money";
import type { BillInput, Metric, WaterfallLine } from "./types";

/**
 * How a monthly allocation of company money is classified. The kind decides
 * whether it is a deductible operating expense, wages that attract employer
 * payroll costs, or money that is really an owner distribution to the household.
 */
export type AllocationKind = "business" | "employees_w2" | "employees_unresolved" | "contractors" | "household" | "mixed";

export const ALLOCATION_KIND_SHORT: Record<AllocationKind, string> = {
  business: "business expense",
  employees_w2: "W-2 wages",
  employees_unresolved: "employees, classification unresolved",
  contractors: "contractor payments",
  household: "owner distribution to the household",
  mixed: "business + household, split not entered",
};

export interface AllocationInput {
  id: string;
  name: string;
  amount: Amount;
  kind: AllocationKind;
  note?: string;
}

export interface OwnerSalaryInput {
  personId: string;
  name: string;
  /** GROSS monthly salary. Never a net spending allowance. */
  grossMonthly: Amount;
}

export interface CompanyInput {
  /** Sum of company bank balances. Unknown if any account balance is unknown. */
  cashBalance: Amount;
  /** When cash is partially unknown, the known portion and the list of unknown accounts. */
  cashKnownSoFar?: Total;
  cashAsOf?: string | null;
  anticipatedRevenue: Amount;
  revenueBasis: "anticipated" | "contracted";
  allocations: AllocationInput[];
  /** Employer-side payroll cost rate in percent of W-2 gross wages (FICA, unemployment, etc.). Null = unknown. */
  employerPayrollCostRatePct: number | null;
  ownerSalaries: OwnerSalaryInput[];
  /** Business income tax reserve in percent of taxable profit. Null = unknown. */
  incomeTaxReserveRatePct: number | null;
  /** Recurring company bills (overhead). */
  bills: BillInput[];
  /** Overhead not captured as bills. Unknown by default. */
  otherOverhead: Amount;
  /** Months of operating cost to hold as a reserve. Null = no reserve rule. */
  cashReserveTargetMonths: number | null;
  /** Planned monthly owner distribution that funds the household. Null = not decided. */
  plannedHouseholdDistribution: Amount;
}

export interface CompanyResult {
  lines: WaterfallLine[];
  cash: Metric;
  revenue: Metric;
  /** Operating commitments plus the tax reserve: everything before any distribution. */
  committed: Metric;
  /** What could be distributed to the household after every commitment (before the planned distribution). */
  distributable: Metric;
  /** What is left after the planned household distribution and household-earmarked allocations. */
  remaining: Metric;
  monthlyOperatingCost: Total;
  reserveTarget: Metric;
  runwayMonths: number | null;
  unresolved: string[];
}

function monthlyBillsTotal(bills: BillInput[]): Total {
  return sumAmounts(bills.map((b) => monthlyEquivalent(b.amount, b.cadence)));
}

export function computeCompany(input: CompanyInput): CompanyResult {
  const lines: WaterfallLine[] = [];
  const unresolved: string[] = [];
  let running: Total = total(0);

  const push = (line: Omit<WaterfallLine, "running">) => {
    const delta = totalOf(line.amount);
    const signed = line.kind === "inflow" ? delta : { ...delta, knownCents: -delta.knownCents };
    running = line.kind === "subtotal" || line.kind === "result" ? running : addTotals(running, signed);
    lines.push({ ...line, running });
  };

  // 1. Revenue — company money, never take-home.
  push({
    id: "revenue",
    label: input.revenueBasis === "contracted" ? "Contracted service revenue" : "Anticipated service revenue",
    kind: "inflow",
    amount: input.anticipatedRevenue,
    source: "Settings → Company → Monthly service revenue",
    note: input.revenueBasis === "anticipated" ? "Anticipated, not yet invoiced. Company money, not personal take-home." : undefined,
  });

  // 2. Owner gross salaries (deductible wages).
  const ownerGross = sumAmounts(input.ownerSalaries.map((o) => o.grossMonthly));
  push({
    id: "owner-salaries",
    label: `Gross W-2 salaries (${input.ownerSalaries.map((o) => o.name).join(", ") || "none"})`,
    kind: "outflow",
    amount: ownerGross.complete ? known(ownerGross.knownCents) : unknown(ownerGross.unknowns.join("; ")),
    source: "Settings → People → Gross salary",
    note: "Gross wages. Net take-home depends on each person's withholding.",
  });

  // 3. Operating allocations (business kinds) before tax; household kinds after tax.
  const businessAllocations = input.allocations.filter((a) => a.kind !== "household");
  const householdAllocations = input.allocations.filter((a) => a.kind === "household");
  for (const a of businessAllocations) {
    if (a.kind === "mixed") unresolved.push(`${a.name}: business vs household split`);
    if (a.kind === "employees_unresolved") unresolved.push(`${a.name}: payroll classification`);
    push({
      id: `alloc-${a.id}`,
      label: a.name,
      kind: "outflow",
      amount: a.amount,
      source: "Settings → Company → Allocations",
      note: [ALLOCATION_KIND_SHORT[a.kind], a.note].filter(Boolean).join(". "),
    });
  }

  // 4. Employer payroll costs on W-2 wages.
  const employerCosts = employerPayrollCosts(input, ownerGross);
  if (!isKnown(employerCosts)) unresolved.push(employerCosts.reason);
  push({
    id: "employer-payroll-costs",
    label: "Employer payroll costs",
    kind: "outflow",
    amount: employerCosts,
    source: "Settings → Company → Employer payroll cost rate",
    note: isKnown(employerCosts) ? `${input.employerPayrollCostRatePct}% of W-2 gross wages` : undefined,
  });

  // 5. Overhead: bills plus other overhead.
  const billsTotal = monthlyBillsTotal(input.bills);
  push({
    id: "overhead-bills",
    label: `Recurring bills (${input.bills.length})`,
    kind: "outflow",
    amount: billsTotal.complete ? known(billsTotal.knownCents) : unknown(`bills with unknown amounts: ${billsTotal.unknowns.join("; ")}`),
    source: "Bills → Company",
  });
  if (!isKnown(input.otherOverhead)) unresolved.push("Other business overhead");
  push({
    id: "other-overhead",
    label: "Other business overhead",
    kind: "outflow",
    amount: input.otherOverhead,
    source: "Settings → Company → Other monthly overhead",
  });

  const operatingCost = addTotals(ownerGross, sumAmounts(businessAllocations.map((a) => a.amount)), totalOf(employerCosts), billsTotal, totalOf(input.otherOverhead));

  // 6. Income tax reserve on taxable profit. A mixed allocation makes the base uncertain.
  const profitBeforeTax = running;
  const mixed = businessAllocations.filter((a) => a.kind === "mixed");
  let taxReserve = percentOfTotal(profitBeforeTax, input.incomeTaxReserveRatePct, "Income tax reserve rate not set");
  if (isKnown(taxReserve) && mixed.length) taxReserve = unknown(`taxable profit depends on the business vs household split of: ${mixed.map((a) => a.name).join(", ")}`);
  if (!isKnown(taxReserve)) unresolved.push(input.incomeTaxReserveRatePct === null ? "Business income tax reserve rate" : `Income tax reserve (${taxReserve.reason})`);
  push({
    id: "tax-reserve",
    label: "Business income tax reserve",
    kind: "reserve",
    amount: isKnown(taxReserve) && taxReserve.cents < 0 ? known(0) : taxReserve,
    source: "Settings → Company → Income tax reserve rate",
    note: isKnown(taxReserve) ? `${input.incomeTaxReserveRatePct}% of profit before distributions` : "Stays unknown until a rate (and any split) is entered. Not assumed to be zero.",
  });

  const distributable = running;
  lines.push({
    id: "distributable",
    label: "Available for owner distributions",
    kind: "result",
    amount: distributable.complete ? known(distributable.knownCents) : unknown("depends on unknown items"),
    running: distributable,
    source: "Computed",
  });

  // 7. Distributions: household-earmarked allocations and the planned monthly distribution.
  for (const a of householdAllocations) {
    push({ id: `alloc-${a.id}`, label: a.name, kind: "outflow", amount: a.amount, source: "Settings → Company → Allocations", note: [ALLOCATION_KIND_SHORT[a.kind], a.note].filter(Boolean).join(". ") });
  }
  if (!isKnown(input.plannedHouseholdDistribution)) unresolved.push("Planned monthly distribution to the household");
  push({
    id: "planned-distribution",
    label: "Planned distribution to the household",
    kind: "outflow",
    amount: input.plannedHouseholdDistribution,
    source: "Settings → Household → Planned company distribution",
    note: "What is intended to be paid out each month to fund shared bills.",
  });
  const remaining = running;
  lines.push({
    id: "remaining",
    label: remaining.complete && remaining.knownCents < 0 ? "Shortfall after distributions" : "Retained in the company",
    kind: "result",
    amount: remaining.complete ? known(remaining.knownCents) : unknown("depends on unknown items"),
    running: remaining,
    source: "Computed",
  });

  const committed = addTotals(operatingCost, totalOf(lines.find((l) => l.id === "tax-reserve")!.amount));

  const reserveTarget: Metric = {
    id: "reserve-target",
    label: "Cash reserve target",
    total:
      input.cashReserveTargetMonths === null
        ? total(0, ["reserve target months not set"])
        : total(operatingCost.knownCents * input.cashReserveTargetMonths, operatingCost.unknowns),
    provenance: {
      formula: "monthly operating cost × reserve months",
      inputs: [
        { label: "Monthly operating cost", value: formatTotal(operatingCost), source: "Computed from commitments" },
        { label: "Reserve months", value: input.cashReserveTargetMonths === null ? "not set" : String(input.cashReserveTargetMonths), source: "Settings → Company → Cash reserve target" },
      ],
      assumptions: [],
      caveats: input.cashReserveTargetMonths === null ? ["No reserve rule set yet."] : operatingCost.complete ? [] : ["Operating cost includes unknown items; the target is a lower bound."],
    },
  };

  const runwayMonths = isKnown(input.cashBalance) && operatingCost.knownCents > 0 ? Math.floor(input.cashBalance.cents / operatingCost.knownCents) : null;
  const allocationNotes = input.allocations.map((a) => `${a.name}: ${ALLOCATION_KIND_SHORT[a.kind]}`);

  const cash: Metric = {
    id: "company-cash",
    label: "Company cash",
    total: input.cashKnownSoFar ?? totalOf(input.cashBalance),
    provenance: {
      formula: "sum of company account balances",
      inputs: [{ label: "Company accounts", value: formatAmount(input.cashBalance), source: input.cashAsOf ? `Accounts → Company (as of ${input.cashAsOf})` : "Accounts → Company" }],
      assumptions: [],
      caveats: isKnown(input.cashBalance) ? [] : ["At least one company account has no balance entered."],
    },
  };

  const revenue: Metric = {
    id: "company-revenue",
    label: input.revenueBasis === "contracted" ? "Contracted monthly revenue" : "Anticipated monthly revenue",
    total: totalOf(input.anticipatedRevenue),
    provenance: {
      formula: "as entered",
      inputs: [{ label: "Monthly service revenue", value: formatAmount(input.anticipatedRevenue), source: "Settings → Company" }],
      assumptions: [input.revenueBasis === "anticipated" ? "Revenue is anticipated, not contracted or invoiced." : "Revenue is contracted."],
      caveats: ["This is company revenue. It is not personal take-home pay."],
    },
  };

  const committedMetric: Metric = {
    id: "company-committed",
    label: "Committed each month",
    total: committed,
    provenance: {
      formula: "gross salaries + business allocations + employer payroll costs + bills + other overhead + tax reserve",
      inputs: lines.filter((l) => (l.kind === "outflow" || l.kind === "reserve") && !l.id.startsWith("planned") && !householdAllocations.some((a) => `alloc-${a.id}` === l.id)).map((l) => ({ label: l.label, value: formatAmount(l.amount), source: l.source })),
      assumptions: allocationNotes,
      caveats: committed.complete ? [] : ["Includes unknown items; the figure shown is what is known so far."],
    },
  };

  const distributableMetric: Metric = {
    id: "company-distributable",
    label: "Available for the household",
    total: distributable,
    provenance: {
      formula: "revenue − committed",
      inputs: [
        { label: "Revenue", value: formatAmount(input.anticipatedRevenue), source: "Settings → Company" },
        { label: "Committed", value: formatTotal(committed), source: "Computed" },
      ],
      assumptions: [input.revenueBasis === "anticipated" ? "Revenue is anticipated, not contracted." : "Revenue is contracted.", ...allocationNotes],
      caveats: distributable.complete
        ? []
        : [`Upper bound only: ${distributable.unknowns.length} unknown item(s) still reduce this figure (${distributable.unknowns.join("; ")}).`],
    },
  };

  const remainingMetric: Metric = {
    id: "company-remaining",
    label: remaining.complete && remaining.knownCents < 0 ? "Shortfall after distributions" : "Retained after distributions",
    total: remaining,
    provenance: {
      formula: "available for distributions − household-earmarked allocations − planned distribution",
      inputs: [
        { label: "Available for distributions", value: formatTotal(distributable), source: "Computed" },
        ...householdAllocations.map((a) => ({ label: a.name, value: formatAmount(a.amount), source: "Settings → Company → Allocations" })),
        { label: "Planned distribution", value: formatAmount(input.plannedHouseholdDistribution), source: "Settings → Household" },
      ],
      assumptions: [],
      caveats: remaining.complete && remaining.knownCents < 0 ? [`The planned distribution exceeds what is available by ${formatAmount(known(-remaining.knownCents))}.`] : [],
    },
  };

  return {
    lines,
    cash,
    revenue,
    committed: committedMetric,
    distributable: distributableMetric,
    remaining: remainingMetric,
    monthlyOperatingCost: operatingCost,
    reserveTarget,
    runwayMonths,
    unresolved,
  };
}

function employerPayrollCosts(input: CompanyInput, ownerGross: Total): Amount {
  const rate = input.employerPayrollCostRatePct;
  if (rate === null) return unknown("Employer payroll cost rate not set");
  if (!ownerGross.complete) return unknown("Gross salaries incomplete");
  const ownerCosts = percentOf(known(ownerGross.knownCents), rate, "rate");
  if (!isKnown(ownerCosts)) return ownerCosts;
  let cents = ownerCosts.cents;
  for (const a of input.allocations) {
    if (a.kind === "employees_unresolved") return unknown(`${a.name}: payroll classification unresolved, so employer payroll costs on it cannot be computed`);
    if (a.kind === "employees_w2") {
      const c = percentOf(a.amount, rate, "rate");
      if (!isKnown(c)) return unknown(`${a.name}: amount not entered`);
      cents += c.cents;
    }
  }
  return known(cents);
}
