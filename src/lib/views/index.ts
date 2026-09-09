import type { Viewer, ViewerSpace } from "../auth/session";
import { assertSpaceAccess } from "../auth/authorize";
import { cardBalance, cashBalance, cashTotal, loadSpaceData, monthlyBillCents, toBillInputs, toGoalInputs, toLedger, type SpaceData } from "../data/spaces";
import {
  billStatuses,
  computeCompany,
  computeHousehold,
  computePersonal,
  monthPeriod,
  project,
  summarizeFlows,
  type BillPeriodStatus,
  type CompanyResult,
  type FlowSummary,
  type HouseholdResult,
  type PersonalResult,
  type Projection,
  type ProjectionInput,
} from "../finance";
import { amountFromNullable, known, unknown, type Amount, type Total } from "../finance/money";
import { unresolvedAssumptions } from "../assumptions";
import { currentMonth } from "../ids";

export const PROJECTION_MONTHS = 6;

export interface SpaceViewBase {
  space: ViewerSpace;
  data: SpaceData;
  month: string;
  flows: FlowSummary;
  previousFlows: FlowSummary;
  bills: BillPeriodStatus[];
  unpaidCommittedCents: number;
  cash: Amount;
  cashTotal: Total;
  cards: Amount;
  projection: Projection;
  projectionInput: ProjectionInput;
}

export interface CompanyView extends SpaceViewBase {
  kind: "company";
  result: CompanyResult;
}
export interface HouseholdView extends SpaceViewBase {
  kind: "household";
  result: HouseholdResult;
}
export interface PersonalView extends SpaceViewBase {
  kind: "personal";
  result: PersonalResult;
  personId: string;
  personName: string;
  /** Net deposits observed in the ledger last full month, as evidence for the withholding estimate. */
  observedNetLastMonthCents: number | null;
  observedWithholdingLastMonthCents: number | null;
}

export type SpaceView = CompanyView | HouseholdView | PersonalView;

function base(viewer: Viewer, space: ViewerSpace, month: string): Omit<SpaceViewBase, "projection" | "projectionInput"> {
  const data = loadSpaceData(viewer, space);
  const ledger = toLedger(data.transactions);
  const period = monthPeriod(month);
  const prev = monthPeriod(addMonth(month, -1));
  const flows = summarizeFlows(ledger, { accountIds: data.accountIds }, period);
  const previousFlows = summarizeFlows(ledger, { accountIds: data.accountIds }, prev);
  const statuses = billStatuses(data.bills.map((b) => ({ id: b.id, monthlyCents: monthlyBillCents(b) })), ledger, period);
  return {
    space,
    data,
    month,
    flows,
    previousFlows,
    bills: statuses.statuses,
    unpaidCommittedCents: statuses.unpaidCommittedCents,
    cash: cashBalance(data.accounts),
    cashTotal: cashTotal(data.accounts),
    cards: cardBalance(data.accounts),
  };
}

export function addMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function personName(viewer: Viewer, personId: string | null): string {
  return viewer.persons.find((p) => p.id === personId)?.name ?? "Unknown person";
}

export function buildCompanyView(viewer: Viewer, month = currentMonth()): CompanyView {
  const space = viewer.spaces.find((sp) => sp.kind === "company");
  if (!space) throw new Error("No company space visible");
  assertSpaceAccess(viewer, space.id, "view");
  const b = base(viewer, space, month);
  const a = viewer.assumptions;
  const owners = viewer.persons.map((p) => ({
    personId: p.id,
    name: p.name,
    grossMonthly: amountFromNullable(a.owners[p.id]?.grossSalaryCents ?? null, `${p.name}'s gross salary not set`),
  }));
  const result = computeCompany({
    cashBalance: b.cash,
    cashKnownSoFar: b.cashTotal,
    cashAsOf: b.data.accounts[0]?.balanceAsOf ?? null,
    anticipatedRevenue: amountFromNullable(a.company.anticipatedRevenueCents, "Monthly revenue not set"),
    revenueBasis: a.company.revenueBasis,
    employeeAllocation: amountFromNullable(a.company.employeeAllocationCents, "Employee allocation not set"),
    employeeClassification: a.company.employeeClassification,
    employerPayrollCostRatePct: a.company.employerPayrollCostRatePct,
    ownerSalaries: owners,
    incomeTaxReserveRatePct: a.company.incomeTaxReserveRatePct,
    bills: toBillInputs(b.data.bills),
    otherOverhead: amountFromNullable(a.company.otherOverheadCents, "Other overhead not entered"),
    cashReserveTargetMonths: a.company.cashReserveTargetMonths,
  });
  const projectionInput: ProjectionInput = {
    startingCash: b.cash,
    startMonth: month,
    months: PROJECTION_MONTHS,
    monthlyInflows: [{ label: result.revenue.label, amount: amountFromNullable(a.company.anticipatedRevenueCents, "revenue not set") }],
    monthlyOutflows: result.lines.filter((l) => l.kind === "outflow" || l.kind === "reserve").map((l) => ({ label: l.label, amount: l.amount })),
    events: a.household.plannedCompanyDistributionCents ? [{ monthOffset: 0, amountCents: -a.household.plannedCompanyDistributionCents, label: "Planned distribution to household", repeatMonths: null }] : [],
  };
  return { kind: "company", ...b, result, projection: project(projectionInput), projectionInput };
}

export function buildHouseholdView(viewer: Viewer, month = currentMonth()): HouseholdView {
  const space = viewer.spaces.find((sp) => sp.kind === "household");
  if (!space) throw new Error("No household space visible");
  assertSpaceAccess(viewer, space.id, "view");
  const b = base(viewer, space, month);
  const a = viewer.assumptions;
  const result = computeHousehold({
    contributions: viewer.persons.map((p) => ({
      personId: p.id,
      name: p.name,
      amount: amountFromNullable(a.owners[p.id]?.householdContributionCents ?? null, `${p.name}'s contribution not set`),
    })),
    companyDistribution: amountFromNullable(a.household.plannedCompanyDistributionCents, "Planned company distribution not set"),
    bills: toBillInputs(b.data.bills),
    goals: toGoalInputs(b.data.goals),
    cashBalance: b.cash,
    cashKnownSoFar: b.cashTotal,
    cashAsOf: b.data.accounts[0]?.balanceAsOf ?? null,
  });
  const projectionInput: ProjectionInput = {
    startingCash: b.cash,
    startMonth: month,
    months: PROJECTION_MONTHS,
    monthlyInflows: result.lines.filter((l) => l.kind === "inflow").map((l) => ({ label: l.label, amount: l.amount })),
    monthlyOutflows: result.lines.filter((l) => l.kind === "outflow").map((l) => ({ label: l.label, amount: l.amount })),
  };
  return { kind: "household", ...b, result, projection: project(projectionInput), projectionInput };
}

export function buildPersonalView(viewer: Viewer, spaceId: string, month = currentMonth()): PersonalView {
  const space = assertSpaceAccess(viewer, spaceId, "view");
  if (space.kind !== "personal" || !space.personId) throw new Error("Not a personal space");
  const b = base(viewer, space, month);
  const a = viewer.assumptions;
  const o = a.owners[space.personId] ?? { grossSalaryCents: null, withholdingRatePct: null, otherNetIncomeCents: 0, householdContributionCents: null };
  const name = personName(viewer, space.personId);
  const result = computePersonal({
    personId: space.personId,
    name,
    grossSalary: amountFromNullable(o.grossSalaryCents, `${name}'s gross salary not set`),
    withholdingRatePct: o.withholdingRatePct,
    otherNetIncome: amountFromNullable(o.otherNetIncomeCents, "Other income not set"),
    householdContribution: amountFromNullable(o.householdContributionCents, `${name}'s household contribution not set`),
    bills: toBillInputs(b.data.bills),
    goals: toGoalInputs(b.data.goals),
    cashBalance: b.cash,
    cashKnownSoFar: b.cashTotal,
    cashAsOf: b.data.accounts[0]?.balanceAsOf ?? null,
  });
  const lastMonth = b.previousFlows;
  const projectionInput: ProjectionInput = {
    startingCash: b.cash,
    startMonth: month,
    months: PROJECTION_MONTHS,
    monthlyInflows: [
      { label: "Net take-home", amount: result.net.total.complete ? known(result.net.total.knownCents) : unknown("net take-home unknown") },
      { label: "Other net income", amount: amountFromNullable(o.otherNetIncomeCents, "other income not set") },
    ],
    monthlyOutflows: [
      { label: "Household contribution", amount: amountFromNullable(o.householdContributionCents, "contribution not set") },
      { label: "Fixed bills", amount: result.lines.find((l) => l.id === "bills")!.amount },
      { label: "Goals", amount: known(result.goals?.totalFundedCents ?? 0) },
      { label: "Discretionary (assumed spent)", amount: known(Math.max(0, result.discretionary.total.complete ? result.discretionary.total.knownCents : 0)) },
    ],
  };
  return {
    kind: "personal",
    ...b,
    result,
    personId: space.personId,
    personName: name,
    observedNetLastMonthCents: lastMonth.incomeCents || null,
    observedWithholdingLastMonthCents: lastMonth.withholdingCents || null,
    projection: project(projectionInput),
    projectionInput,
  };
}

export function buildSpaceView(viewer: Viewer, spaceId: string, month = currentMonth()): SpaceView {
  const space = assertSpaceAccess(viewer, spaceId, "view");
  if (space.kind === "company") return buildCompanyView(viewer, month);
  if (space.kind === "household") return buildHouseholdView(viewer, month);
  return buildPersonalView(viewer, spaceId, month);
}

export interface OverviewView {
  month: string;
  company: CompanyView | null;
  household: HouseholdView | null;
  personal: PersonalView[];
  unresolved: { key: string; label: string; where: string }[];
  /** Cash the viewer can see, per space; never summed across spaces. */
  cashBySpace: { space: ViewerSpace; cash: Amount; cashTotal: Total; cards: Amount }[];
}

export function buildOverview(viewer: Viewer, month = currentMonth()): OverviewView {
  const company = viewer.spaces.some((sp) => sp.kind === "company") ? buildCompanyView(viewer, month) : null;
  const household = viewer.spaces.some((sp) => sp.kind === "household") ? buildHouseholdView(viewer, month) : null;
  const personal = viewer.spaces.filter((sp) => sp.kind === "personal").map((sp) => buildPersonalView(viewer, sp.id, month));
  const names = Object.fromEntries(viewer.persons.map((p) => [p.id, p.name]));
  const all: SpaceView[] = [...(company ? [company] : []), ...(household ? [household] : []), ...personal];
  return {
    month,
    company,
    household,
    personal,
    unresolved: unresolvedAssumptions(viewer.assumptions, names).filter((u) => {
      // Hide other people's personal assumptions the viewer cannot see anyway.
      const pid = viewer.persons.find((p) => u.key.startsWith(`${p.id}-`))?.id;
      if (!pid) return true;
      return viewer.spaces.some((sp) => sp.personId === pid) || u.key.endsWith("-contribution");
    }),
    cashBySpace: all.map((v) => ({ space: v.space, cash: v.cash, cashTotal: v.cashTotal, cards: v.cards })),
  };
}

export function totalOrUnknown(t: Total): Amount {
  return t.complete ? known(t.knownCents) : unknown(t.unknowns.join("; "));
}
