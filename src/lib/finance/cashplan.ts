import { formatCents, formatTotal, isKnown, known, monthlyEquivalent, sumAmounts, total, totalOf, unknown, type Amount, type Cadence, type Total } from "./money";
import { employerPayrollCost } from "./payroll";
import type { Metric } from "./types";

/**
 * The company forward money plan. It separates expected receipts from cash
 * received, lists every known monthly commitment once, keeps unknown costs
 * unknown, and reports a partial cash-planning remainder with an exact label.
 * It is never taxable profit, a bank balance, approved distributions, or
 * safe-to-spend cash.
 */

export interface PlannedBill {
  id: string;
  name: string;
  amount: Amount;
  cadence: Cadence;
  dueDay: number | null;
  /** Who the payment is for. */
  beneficiary: "company" | "household" | "person" | "split";
  purpose: "business" | "personal" | "mixed" | "unresolved";
  treatment: string;
  paidThisPeriod: boolean;
}

export interface PlannedSubscription {
  id: string;
  provider: string;
  product: string;
  tier: string | null;
  quantity: number;
  unitPrice: Amount;
  interval: "monthly" | "annual";
  kind: "subscription" | "api_usage" | "saas";
  status: "planned" | "active" | "cancelled";
}

export interface PlannedPurchase {
  id: string;
  name: string;
  price: Amount;
  targetMonth: string | null;
  status: "planned" | "approved" | "purchased" | "cancelled";
  beneficiary: "company" | "household" | "person" | "split";
  purpose: "business" | "personal" | "mixed" | "unresolved";
}

export interface CashPlanInput {
  month: string;
  recordedCash: Total;
  cashAsOf: string | null;
  expectedRevenue: Amount;
  revenueBasis: "anticipated" | "contracted";
  receivedThisMonthCents: number;
  grossWages: { name: string; gross: Amount }[];
  employerPayrollCostRatePct: number | null;
  /** Bills the company pays, whoever benefits. */
  companyPaidBills: PlannedBill[];
  subscriptions: PlannedSubscription[];
  /** Actual metered API spend recorded last full month, when the ledger has it. */
  apiUsageLastMonthCents: number | null;
  otherOverhead: Amount;
  purchasePlans: PlannedPurchase[];
  taxReserve: { ratePct: number | null; reviewStatus: string; note: string };
  cashReserveTargetMonths: number | null;
}

export interface PlanLine {
  id: string;
  label: string;
  amount: Amount;
  group: "receipts" | "payroll" | "household_via_company" | "operating" | "one_time" | "unknown_costs";
  note?: string;
}

export interface CashPlanResult {
  lines: PlanLine[];
  expectedReceipts: Metric;
  receivedSoFar: Metric;
  knownCommitments: Metric;
  /** Expected receipts minus every KNOWN recurring commitment: a partial remainder, explicitly labelled. */
  partialRemainder: Metric;
  oneTimeThisMonth: Total;
  unknownCosts: string[];
  recordedCash: Metric;
  subscriptionsTotal: Total;
  householdViaCompany: Total;
  unpaidBillsThisMonthCents: number;
  runwayMonthsOnKnownCosts: number | null;
}

const PARTIAL_LABEL = "Partial cash-planning remainder before unlisted employer costs, taxes, insurance, software, purchases and reserves";

export function computeCashPlan(input: CashPlanInput): CashPlanResult {
  const lines: PlanLine[] = [];
  const unknownCosts: string[] = [];

  lines.push({ id: "receipts", label: input.revenueBasis === "contracted" ? "Contracted service receipts" : "Expected service receipts", amount: input.expectedRevenue, group: "receipts", note: "Expected, not received. Nothing is recognised until a deposit is recorded." });

  const wages = sumAmounts(input.grossWages.map((w) => w.gross));
  lines.push({ id: "wages", label: `Gross wages (${input.grossWages.map((w) => w.name).join(", ")})`, amount: wages.complete ? known(wages.knownCents) : unknown(wages.unknowns.join("; ")), group: "payroll", note: "Employee withholding is inside this figure, not an extra cost." });
  const employer = employerPayrollCost(wages, input.employerPayrollCostRatePct);
  if (!isKnown(employer)) unknownCosts.push("Employer payroll taxes and payroll-provider fees");
  lines.push({ id: "employer", label: "Employer payroll costs", amount: employer, group: isKnown(employer) ? "payroll" : "unknown_costs" });

  const household = input.companyPaidBills.filter((b) => b.beneficiary !== "company");
  const business = input.companyPaidBills.filter((b) => b.beneficiary === "company");
  const householdTotal = sumAmounts(household.map((b) => monthlyEquivalent(b.amount, b.cadence)));
  for (const b of household) {
    lines.push({ id: `bill-${b.id}`, label: b.name, amount: monthlyEquivalent(b.amount, b.cadence), group: "household_via_company", note: `Paid by the company for the ${b.beneficiary}; ${b.purpose} purpose; accounting treatment: ${b.treatment.replace(/_/g, " ")}.` });
  }
  const businessBills = sumAmounts(business.map((b) => monthlyEquivalent(b.amount, b.cadence)));
  for (const b of business) lines.push({ id: `bill-${b.id}`, label: b.name, amount: monthlyEquivalent(b.amount, b.cadence), group: "operating" });

  const subs = input.subscriptions.filter((s) => s.status !== "cancelled");
  const subsTotal = sumAmounts(subs.map((s) => subscriptionMonthly(s)));
  for (const s of subs) {
    lines.push({ id: `sub-${s.id}`, label: `${s.provider} ${s.product}${s.tier ? ` (${s.tier})` : ""} × ${s.quantity}`, amount: subscriptionMonthly(s), group: s.kind === "api_usage" ? "operating" : "operating", note: s.kind === "api_usage" ? "Metered usage; tracked separately from consumer subscriptions." : s.tier ? undefined : "Tier and price to confirm." });
  }
  if (input.apiUsageLastMonthCents !== null) lines.push({ id: "api-actual", label: "API usage, last month actual", amount: known(input.apiUsageLastMonthCents), group: "operating", note: "From the ledger. Planning estimate for future months is not set." });
  if (!isKnown(input.otherOverhead)) unknownCosts.push("Other overhead (insurance, hosting, CPA, utilities)");
  lines.push({ id: "overhead", label: "Other overhead", amount: input.otherOverhead, group: isKnown(input.otherOverhead) ? "operating" : "unknown_costs" });

  const tax = input.taxReserve.ratePct === null ? unknown(`Tax reserve not set (${input.taxReserve.reviewStatus})`) : unknown("Tax reserve needs a reviewed base; a rate alone is not enough");
  unknownCosts.push("Company taxes and reserves (federal/California entity level, shareholder pass-through)");
  lines.push({ id: "tax", label: "Taxes and reserves", amount: tax, group: "unknown_costs", note: input.taxReserve.note });

  const oneTime = input.purchasePlans.filter((p) => p.status !== "cancelled" && p.status !== "purchased" && p.targetMonth === input.month);
  const oneTimeTotal = sumAmounts(oneTime.map((p) => p.price));
  for (const p of oneTime) lines.push({ id: `plan-${p.id}`, label: `${p.name} (one-time, this month)`, amount: p.price, group: "one_time", note: `${p.purpose} purpose, for the ${p.beneficiary}. Affects this month only.` });

  const knownCommitments = total(
    wages.knownCents + (isKnown(employer) ? employer.cents : 0) + householdTotal.knownCents + businessBills.knownCents + subsTotal.knownCents + (isKnown(input.otherOverhead) ? input.otherOverhead.cents : 0),
    [...wages.unknowns, ...householdTotal.unknowns, ...businessBills.unknowns, ...subsTotal.unknowns, ...unknownCosts],
  );
  const receipts = totalOf(input.expectedRevenue);
  const remainder = total(receipts.knownCents - knownCommitments.knownCents, [...receipts.unknowns, ...knownCommitments.unknowns]);
  const monthlyKnownCost = knownCommitments.knownCents;
  const runway = input.recordedCash.complete && monthlyKnownCost > 0 ? Math.floor(input.recordedCash.knownCents / monthlyKnownCost) : null;

  const metric = (id: string, label: string, t: Total, formula: string, inputs: Metric["provenance"]["inputs"], assumptions: string[], caveats: string[]): Metric => ({ id, label, total: t, provenance: { formula, inputs, assumptions, caveats } });

  return {
    lines,
    expectedReceipts: metric("expected-receipts", "Expected receipts", receipts, "as entered", [{ label: "Monthly service payment", value: formatTotal(receipts), source: "Settings → Company" }], [`Revenue is ${input.revenueBasis}. The payer is a related party; contract, invoices and payment dates are unconfirmed.`], ["Expected, not received. It is company money, not take-home pay."]),
    receivedSoFar: metric("received", "Received this month", total(input.receivedThisMonthCents), "sum of income transactions this month", [{ label: "Income transactions", value: formatCents(input.receivedThisMonthCents), source: "Ledger" }], [], []),
    knownCommitments: metric(
      "known-commitments",
      "Known monthly commitments",
      knownCommitments,
      "gross wages + company-paid household bills + business bills + subscriptions + known overhead (+ employer costs when known)",
      lines.filter((l) => l.group !== "receipts" && l.group !== "one_time").map((l) => ({ label: l.label, value: isKnown(l.amount) ? formatCents(l.amount.cents) : "unknown", source: l.group.replace(/_/g, " ") })),
      ["Each commitment is counted once."],
      knownCommitments.complete ? [] : [`Unknown costs are not included: ${[...new Set(knownCommitments.unknowns)].join("; ")}.`],
    ),
    partialRemainder: metric(
      "partial-remainder",
      PARTIAL_LABEL,
      remainder,
      "expected receipts − known monthly commitments",
      [
        { label: "Expected receipts", value: formatTotal(receipts), source: "Settings → Company" },
        { label: "Known commitments", value: formatTotal(knownCommitments), source: "Computed" },
      ],
      ["Not taxable profit, not a bank balance, not approved owner distributions, not safe-to-spend cash."],
      [`Still missing: ${[...new Set(unknownCosts)].join("; ")}.`],
    ),
    oneTimeThisMonth: oneTimeTotal,
    unknownCosts: [...new Set(unknownCosts)],
    recordedCash: metric("recorded-cash", "Recorded cash", input.recordedCash, "sum of company account balances", [{ label: "Company accounts", value: formatTotal(input.recordedCash), source: input.cashAsOf ? `Accounts (as of ${input.cashAsOf})` : "Accounts" }], [], input.recordedCash.complete ? ["Recorded, not reconciled against a bank statement."] : ["At least one account has no balance entered."]),
    subscriptionsTotal: subsTotal,
    householdViaCompany: householdTotal,
    unpaidBillsThisMonthCents: input.companyPaidBills.filter((b) => !b.paidThisPeriod).reduce((a, b) => a + (isKnown(monthlyEquivalent(b.amount, b.cadence)) ? (monthlyEquivalent(b.amount, b.cadence) as { cents: number }).cents : 0), 0),
    runwayMonthsOnKnownCosts: runway,
  };
}

export function subscriptionMonthly(s: PlannedSubscription): Amount {
  if (!isKnown(s.unitPrice)) return unknown(`${s.provider} ${s.product}: price not confirmed`);
  const per = s.unitPrice.cents * s.quantity;
  return known(s.interval === "annual" ? Math.round(per / 12) : per);
}

export { PARTIAL_LABEL };
