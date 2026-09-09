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
 * How the $8,000/month employee allocation is classified for payroll purposes.
 * "unresolved" is the honest default: employer payroll costs on it cannot be
 * computed until it is resolved.
 */
export type EmployeeClassification = "unresolved" | "w2_gross" | "w2_gross_plus_employer_costs" | "contractor";

export const EMPLOYEE_CLASSIFICATION_LABELS: Record<EmployeeClassification, string> = {
  unresolved: "Unresolved — classification still to be decided",
  w2_gross: "W-2 gross wages (employer payroll costs are extra)",
  w2_gross_plus_employer_costs: "W-2 all-in (gross wages plus employer payroll costs)",
  contractor: "Contractor payments (no employer payroll costs)",
};

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
  employeeAllocation: Amount;
  employeeClassification: EmployeeClassification;
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
}

export interface CompanyResult {
  lines: WaterfallLine[];
  cash: Metric;
  revenue: Metric;
  committed: Metric;
  /** Cash-basis owner distributions available for the household after every commitment. */
  distributable: Metric;
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

  // 1. Revenue — anticipated, not take-home.
  push({
    id: "revenue",
    label: input.revenueBasis === "contracted" ? "Contracted service revenue" : "Anticipated service revenue",
    kind: "inflow",
    amount: input.anticipatedRevenue,
    source: "Settings → Company → Monthly service revenue",
    note: input.revenueBasis === "anticipated" ? "Anticipated, not yet invoiced. Company money, not personal take-home." : undefined,
  });

  // 2. Employee allocation.
  const classificationLabel = EMPLOYEE_CLASSIFICATION_LABELS[input.employeeClassification];
  if (input.employeeClassification === "unresolved") unresolved.push("Employee allocation payroll classification");
  push({
    id: "employees",
    label: "Employee allocation",
    kind: "outflow",
    amount: input.employeeAllocation,
    source: "Settings → Company → Employee allocation",
    note: classificationLabel,
  });

  // 3. Owner gross salaries.
  const ownerGross = sumAmounts(input.ownerSalaries.map((o) => o.grossMonthly));
  push({
    id: "owner-salaries",
    label: `Owner gross salaries (${input.ownerSalaries.map((o) => o.name).join(", ") || "none"})`,
    kind: "outflow",
    amount: ownerGross.complete ? known(ownerGross.knownCents) : unknown(ownerGross.unknowns.join("; ")),
    source: "Settings → Owners → Gross salary",
    note: "Gross wages. Net take-home depends on each owner's withholding assumption.",
  });

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

  // Operating cost = everything above except revenue (used for reserve/runway).
  const operatingCost = addTotals(
    totalOf(input.employeeAllocation),
    ownerGross,
    totalOf(employerCosts),
    billsTotal,
    totalOf(input.otherOverhead),
  );

  // 6. Income tax reserve on profit before owner distributions.
  const profitBeforeTax = running;
  const taxReserve = percentOfTotal(profitBeforeTax, input.incomeTaxReserveRatePct, "Income tax reserve rate not set");
  if (!isKnown(taxReserve)) unresolved.push(input.incomeTaxReserveRatePct === null ? "Business income tax reserve rate" : "Income tax reserve (depends on unknown costs)");
  push({
    id: "tax-reserve",
    label: "Business income tax reserve",
    kind: "reserve",
    amount: isKnown(taxReserve) && taxReserve.cents < 0 ? known(0) : taxReserve,
    source: "Settings → Company → Income tax reserve rate",
    note: isKnown(taxReserve) ? `${input.incomeTaxReserveRatePct}% of profit before distributions` : "Stays unknown until a rate is entered. Not assumed to be zero.",
  });

  const distributable = running;
  lines.push({
    id: "distributable",
    label: "Available for owner distributions to the household",
    kind: "result",
    amount: distributable.complete ? known(distributable.knownCents) : unknown("depends on unknown items"),
    running: distributable,
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
      caveats: operatingCost.complete ? [] : ["Operating cost includes unknown items; the target is a lower bound."],
    },
  };

  const runwayMonths = isKnown(input.cashBalance) && operatingCost.knownCents > 0 ? Math.floor(input.cashBalance.cents / operatingCost.knownCents) : null;

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
      formula: "employees + owner gross salaries + employer payroll costs + bills + other overhead + tax reserve",
      inputs: lines.filter((l) => l.kind === "outflow" || l.kind === "reserve").map((l) => ({ label: l.label, value: formatAmount(l.amount), source: l.source })),
      assumptions: [classificationLabel],
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
      assumptions: [input.revenueBasis === "anticipated" ? "Revenue is anticipated, not contracted." : "Revenue is contracted."],
      caveats: distributable.complete
        ? []
        : [
            `Upper bound only: ${distributable.unknowns.length} unknown cost item(s) still reduce this figure (${distributable.unknowns.join("; ")}).`,
          ],
    },
  };

  return {
    lines,
    cash,
    revenue,
    committed: committedMetric,
    distributable: distributableMetric,
    monthlyOperatingCost: operatingCost,
    reserveTarget,
    runwayMonths,
    unresolved,
  };
}

function employerPayrollCosts(input: CompanyInput, ownerGross: Total): Amount {
  const rate = input.employerPayrollCostRatePct;
  if (rate === null) return unknown("Employer payroll cost rate not set");
  if (!ownerGross.complete) return unknown("Owner gross salaries incomplete");

  // Owner salaries are gross W-2 wages: employer costs always apply.
  const ownerCosts = percentOf(known(ownerGross.knownCents), rate, "rate");
  if (!isKnown(ownerCosts)) return ownerCosts;

  switch (input.employeeClassification) {
    case "contractor":
      return ownerCosts;
    case "w2_gross_plus_employer_costs":
      return ownerCosts; // employer costs already inside the allocation
    case "w2_gross": {
      const empl = percentOf(input.employeeAllocation, rate, "rate");
      return isKnown(empl) ? known(empl.cents + ownerCosts.cents) : empl;
    }
    case "unresolved":
      return unknown("Employee allocation classification unresolved, so employer payroll costs on it cannot be computed");
  }
}
