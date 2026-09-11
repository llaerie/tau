import type { Viewer, ViewerSpace } from "../auth/session";
import { assertSpaceAccess } from "../auth/authorize";
import { cardBalance, cashBalance, cashTotal, foodSpentCents, loadPreferences, loadPurchasePlans, loadSpaceData, loadSubscriptions, monthlyBillCents, toBillInputs, toLedger, type SpaceData } from "../data/spaces";
import type * as s from "../db/schema";
import { expenseShares } from "../db/schema";
import { getDb } from "../db";
import { and, eq, gte, lte } from "drizzle-orm";
import { billStatuses, computeCashPlan, computeFoodPlan, computeTakeHome, monthPeriod, project, subscriptionMonthly, summarizeFlows, type BillPeriodStatus, type CashPlanResult, type FlowSummary, type FoodPlanResult, type PlannedPurchase, type PlannedSubscription, type Projection, type ProjectionInput, type TakeHomeResult } from "../finance";
import { amountFromNullable, formatCents, isKnown, known, sumAmounts, total, unknown, type Amount, type Total } from "../finance/money";
import { defaultOwnerAssumptions, reviewItems, type OwnerAssumptions, type ReviewItem } from "../assumptions";
import { currentMonth, todayIso } from "../ids";

export const PROJECTION_MONTHS = 6;

export interface SpaceViewBase {
  space: ViewerSpace;
  data: SpaceData;
  month: string;
  flows: FlowSummary;
  previousFlows: FlowSummary;
  bills: BillPeriodStatus[];
  cash: Amount;
  cashTotal: Total;
  cards: Amount;
  cashAsOf: string | null;
}

export interface CompanyView extends SpaceViewBase {
  kind: "company";
  plan: CashPlanResult;
  subscriptions: s.Subscription[];
  purchasePlans: s.PurchasePlan[];
  projection: Projection;
  projectionInput: ProjectionInput;
  reviewCount: number;
}

export interface HouseholdView extends SpaceViewBase {
  kind: "household";
  /** Bills the company pays for the household: a benefit, not joint-account cash. */
  companyPaidBills: (s.Bill & { monthlyCents: number | null; paid: boolean })[];
  ownBills: (s.Bill & { monthlyCents: number | null; paid: boolean })[];
  companyPaidTotal: Total;
  ownBillsTotal: Total;
  groceriesThisMonthCents: number;
}

export interface PersonalView extends SpaceViewBase {
  kind: "personal";
  personId: string;
  personName: string;
  personTitle: string | null;
  takeHome: TakeHomeResult;
  food: FoodPlanResult;
  owner: OwnerAssumptions;
  fixedBillsTotal: Total;
  upcoming: Obligation[];
}

export type SpaceView = CompanyView | HouseholdView | PersonalView;

export interface Obligation {
  id: string;
  label: string;
  dueDate: string;
  amount: Amount;
  kind: "bill" | "subscription" | "purchase_plan" | "payroll";
  spaceId: string;
  paid: boolean;
  payer: string;
}

export function addMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function base(viewer: Viewer, space: ViewerSpace, month: string): SpaceViewBase {
  const data = loadSpaceData(viewer, space);
  const ledger = toLedger(data.transactions);
  const period = monthPeriod(month);
  const prev = monthPeriod(addMonth(month, -1));
  const flows = summarizeFlows(ledger, { accountIds: data.accountIds }, period);
  const previousFlows = summarizeFlows(ledger, { accountIds: data.accountIds }, prev);
  const statuses = billStatuses(data.bills.map((b) => ({ id: b.id, monthlyCents: monthlyBillCents(b) })), toLedger(data.billPayments), period);
  return { space, data, month, flows, previousFlows, bills: statuses.statuses, cash: cashBalance(data.accounts), cashTotal: cashTotal(data.accounts), cards: cardBalance(data.accounts), cashAsOf: data.accounts[0]?.balanceAsOf ?? null };
}

function ownerOf(viewer: Viewer, personId: string): OwnerAssumptions {
  return viewer.assumptions.owners[personId] ?? defaultOwnerAssumptions();
}

function billPaidThisMonth(payments: s.Transaction[], billId: string, month: string): boolean {
  const p = monthPeriod(month);
  return payments.some((t) => t.billId === billId && !t.voidedAt && t.date >= p.from && t.date <= p.to);
}

export function toPlannedSubscription(sub: s.Subscription): PlannedSubscription {
  return { id: sub.id, provider: sub.provider, product: sub.product, tier: sub.tier, quantity: sub.quantity, unitPrice: amountFromNullable(sub.unitPriceCents, `${sub.provider} ${sub.product}: price not confirmed`), interval: sub.interval, kind: sub.kind, status: sub.status };
}

export function toPlannedPurchase(p: s.PurchasePlan): PlannedPurchase {
  const price = p.unitPriceCents === null ? unknown(`${p.name}: price not entered`) : known(p.unitPriceCents * p.quantity + (p.taxShippingCents ?? 0));
  return { id: p.id, name: p.name, price, targetMonth: p.targetMonth, status: p.status, beneficiary: p.beneficiary, purpose: p.purpose };
}

export function buildCompanyView(viewer: Viewer, month = currentMonth()): CompanyView {
  const space = viewer.spaces.find((sp) => sp.kind === "company");
  if (!space) throw new Error("No company space visible");
  assertSpaceAccess(viewer, space.id, "view");
  const b = base(viewer, space, month);
  const a = viewer.assumptions;
  const subs = loadSubscriptions(viewer.workspace.id).filter((x) => x.spaceId === space.id);
  const plans = loadPurchasePlans(viewer.workspace.id).filter((x) => x.payerSpaceId === space.id);
  const period = monthPeriod(month);
  const prev = monthPeriod(addMonth(month, -1));
  const apiCat = b.data.categories.find((c) => c.name === "API usage")?.id;
  const apiLastMonth = apiCat ? b.data.transactions.filter((t) => t.categoryId === apiCat && !t.voidedAt && t.kind === "expense" && t.date >= prev.from && t.date <= prev.to).reduce((x, t) => x + t.amountCents, 0) : 0;
  const allPaid = [...b.data.bills, ...b.data.billsPaidForOthers];
  const paymentsAll = [...b.data.billPayments, ...b.data.transactions.filter((t) => t.kind === "bill_payment")];
  const plan = computeCashPlan({
    month,
    recordedCash: b.cashTotal,
    cashAsOf: b.cashAsOf,
    expectedRevenue: amountFromNullable(a.company.anticipatedRevenueCents, "Monthly service payment not set"),
    revenueBasis: a.company.revenueBasis,
    receivedThisMonthCents: b.flows.incomeCents,
    grossWages: viewer.persons.map((p) => ({ name: p.name, gross: amountFromNullable(ownerOf(viewer, p.id).grossSalaryCents, `${p.name}'s gross salary not set`) })),
    employerPayrollCostRatePct: a.company.employerPayrollCostRatePct,
    companyPaidBills: allPaid.map((bill) => ({ id: bill.id, name: bill.name, amount: amountFromNullable(bill.amountCents, `${bill.name} amount not entered`), cadence: bill.cadence, dueDay: bill.dueDay, beneficiary: bill.beneficiary ?? (bill.spaceId === space.id ? "company" : "household"), purpose: bill.purpose ?? (bill.spaceId === space.id ? "business" : "unresolved"), treatment: bill.treatment ?? "review_required", paidThisPeriod: billPaidThisMonth(paymentsAll, bill.id, month) })),
    subscriptions: subs.map(toPlannedSubscription),
    apiUsageLastMonthCents: apiLastMonth || null,
    otherOverhead: amountFromNullable(a.company.otherOverheadCents, "Other overhead not entered"),
    purchasePlans: plans.map(toPlannedPurchase),
    taxReserve: { ratePct: a.company.taxes.reserveRatePct, reviewStatus: a.company.taxes.reviewStatus, note: a.company.taxes.note },
    cashReserveTargetMonths: a.company.cashReserveTargetMonths,
  });
  const projectionInput: ProjectionInput = {
    startingCash: b.cash,
    startMonth: month,
    months: PROJECTION_MONTHS,
    monthlyInflows: [{ label: "Expected receipts", amount: amountFromNullable(a.company.anticipatedRevenueCents, "revenue not set") }],
    monthlyOutflows: plan.lines.filter((l) => l.group !== "receipts" && l.group !== "one_time").map((l) => ({ label: l.label, amount: l.amount })),
    events: plans
      .filter((p) => p.status !== "cancelled" && p.status !== "purchased" && p.targetMonth && p.unitPriceCents !== null)
      .map((p) => ({ monthOffset: monthOffset(month, p.targetMonth!), amountCents: -(p.unitPriceCents! * p.quantity + (p.taxShippingCents ?? 0)), label: p.name }))
      .filter((e) => e.monthOffset >= 0 && e.monthOffset < PROJECTION_MONTHS),
  };
  const reviewCount = b.data.transactions.filter((t) => t.reviewStatus === "review_required" && !t.voidedAt && t.date >= period.from && t.date <= period.to).length;
  return { kind: "company", ...b, plan, subscriptions: subs, purchasePlans: plans, projection: project(projectionInput), projectionInput, reviewCount };
}

function monthOffset(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function buildHouseholdView(viewer: Viewer, month = currentMonth()): HouseholdView {
  const space = viewer.spaces.find((sp) => sp.kind === "household");
  if (!space) throw new Error("No household space visible");
  assertSpaceAccess(viewer, space.id, "view");
  const b = base(viewer, space, month);
  const decorate = (bill: s.Bill) => ({ ...bill, monthlyCents: monthlyBillCents(bill), paid: billPaidThisMonth(b.data.billPayments, bill.id, month) });
  const companyPaid = b.data.bills.filter((bill) => bill.payerSpaceId && bill.payerSpaceId !== space.id).map(decorate);
  const own = b.data.bills.filter((bill) => !bill.payerSpaceId || bill.payerSpaceId === space.id).map(decorate);
  const groceriesCat = b.data.categories.find((c) => c.name === "Groceries")?.id;
  const period = monthPeriod(month);
  const groceries = groceriesCat ? b.data.transactions.filter((t) => t.categoryId === groceriesCat && !t.voidedAt && t.kind === "expense" && t.date >= period.from && t.date <= period.to).reduce((x, t) => x + t.amountCents, 0) : 0;
  return {
    kind: "household",
    ...b,
    companyPaidBills: companyPaid,
    ownBills: own,
    companyPaidTotal: sumAmounts(companyPaid.map((bill) => amountFromNullable(bill.monthlyCents, `${bill.name} amount unknown`))),
    ownBillsTotal: sumAmounts(own.map((bill) => amountFromNullable(bill.monthlyCents, `${bill.name} amount unknown`))),
    groceriesThisMonthCents: groceries,
  };
}

export function buildPersonalView(viewer: Viewer, spaceId: string, month = currentMonth()): PersonalView {
  const space = assertSpaceAccess(viewer, spaceId, "view");
  if (space.kind !== "personal" || !space.personId) throw new Error("Not a personal space");
  const b = base(viewer, space, month);
  const o = ownerOf(viewer, space.personId);
  const person = viewer.persons.find((p) => p.id === space.personId);
  const name = person?.name ?? "Unknown person";
  const period = monthPeriod(month);
  const takeHome = computeTakeHome(amountFromNullable(o.grossSalaryCents, `${name}'s gross salary not set`), viewer.assumptions.payrollRules, o.withholding);
  const fixedBills = sumAmounts(toBillInputs(b.data.bills).map((bill) => (isKnown(bill.amount) ? known(monthlyBillCents(b.data.bills.find((x) => x.id === bill.id)!) ?? 0) : bill.amount)));
  const spent = foodSpentCents(b.data, period);
  const food = computeFoodPlan({
    personId: space.personId,
    name,
    takeHome,
    foodTargetCents: o.foodTargetCents,
    foodSpentCents: spent.cents,
    foodTransactionCount: spent.count,
    allocations: o.allocations,
    fixedBillsCents: fixedBills,
    householdContributionCents: o.householdContributionCents ?? 0,
  });
  return { kind: "personal", ...b, personId: space.personId, personName: name, personTitle: person?.title ?? null, takeHome, food, owner: o, fixedBillsTotal: fixedBills, upcoming: upcomingObligations(viewer, [space.id], 30) };
}

export function buildSpaceView(viewer: Viewer, spaceId: string, month = currentMonth()): SpaceView {
  const space = assertSpaceAccess(viewer, spaceId, "view");
  if (space.kind === "company") return buildCompanyView(viewer, month);
  if (space.kind === "household") return buildHouseholdView(viewer, month);
  return buildPersonalView(viewer, spaceId, month);
}

/** Upcoming dated obligations across the given spaces, within a horizon in days. Read-only. */
export function upcomingObligations(viewer: Viewer, spaceIds: string[], horizonDays: number): Obligation[] {
  const today = todayIso();
  const end = new Date(Date.parse(today) + horizonDays * 86400_000).toISOString().slice(0, 10);
  const out: Obligation[] = [];
  const spaceName = (id: string) => viewer.spaces.find((sp) => sp.id === id)?.name ?? "another space";
  for (const sid of spaceIds) {
    const sp = viewer.spaces.find((x) => x.id === sid);
    if (!sp) continue;
    const data = loadSpaceData(viewer, sp);
    const billsHere = [...data.bills, ...data.billsPaidForOthers.filter((bill) => !data.bills.some((x) => x.id === bill.id))];
    for (const bill of billsHere) {
      if (!bill.dueDay) continue;
      for (const m of [today.slice(0, 7), addMonth(today.slice(0, 7), 1)]) {
        const due = `${m}-${String(Math.min(bill.dueDay, 28)).padStart(2, "0")}`;
        if (due < today || due > end) continue;
        const paid = billPaidThisMonth(bill.spaceId === sid ? data.billPayments : data.transactions.filter((t) => t.kind === "bill_payment"), bill.id, m);
        out.push({ id: `${bill.id}-${m}`, label: bill.name, dueDate: due, amount: amountFromNullable(monthlyBillCents(bill), "amount unknown"), kind: "bill", spaceId: sid, paid, payer: bill.payerSpaceId ? spaceName(bill.payerSpaceId) : spaceName(bill.spaceId) });
      }
    }
    if (sp.kind === "company") {
      for (const p of viewer.persons) {
        for (const m of [today.slice(0, 7), addMonth(today.slice(0, 7), 1)]) {
          const due = `${m}-25`;
          if (due < today || due > end) continue;
          out.push({ id: `payroll-${p.id}-${m}`, label: `Payroll — ${p.name} (gross)`, dueDate: due, amount: amountFromNullable(ownerOf(viewer, p.id).grossSalaryCents, "salary not set"), kind: "payroll", spaceId: sid, paid: false, payer: sp.name });
        }
      }
      for (const sub of loadSubscriptions(viewer.workspace.id).filter((x) => x.spaceId === sid && x.status !== "cancelled" && x.renewalDate)) {
        if (sub.renewalDate! >= today && sub.renewalDate! <= end) out.push({ id: `sub-${sub.id}`, label: `${sub.provider} ${sub.product}`, dueDate: sub.renewalDate!, amount: subscriptionMonthly(toPlannedSubscription(sub)), kind: "subscription", spaceId: sid, paid: false, payer: sp.name });
      }
      for (const plan of loadPurchasePlans(viewer.workspace.id).filter((x) => x.payerSpaceId === sid && x.status === "approved" && x.targetMonth)) {
        const due = `${plan.targetMonth}-15`;
        if (due >= today && due <= end) out.push({ id: `plan-${plan.id}`, label: plan.name, dueDate: due, amount: toPlannedPurchase(plan).price, kind: "purchase_plan", spaceId: sid, paid: false, payer: sp.name });
      }
    }
  }
  return out.sort((x, y) => x.dueDate.localeCompare(y.dueDate));
}

// ---------- Briefing, partner summary ----------

export interface Briefing {
  greeting: string;
  personName: string;
  summary: string[];
  nextStep: ReviewItem | null;
  attention: ReviewItem[];
  scope: "me" | "company" | "household";
  moneyLine: { label: string; value: string; caveat: string | null } | null;
  upcoming: Obligation[];
  asOf: string;
  isDemo: boolean;
  incomplete: boolean;
}

export function buildBriefing(viewer: Viewer): Briefing {
  const now = new Date();
  const hour = now.getUTCHours();
  const name = viewer.person?.name ?? viewer.user.name;
  const greeting = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${name}.`;
  const canSeeCompany = viewer.spaces.some((sp) => sp.kind === "company");
  const items = reviewItems(viewer.assumptions, { personId: viewer.person?.id ?? null, personNames: Object.fromEntries(viewer.persons.map((p) => [p.id, p.name])), visiblePersonIds: viewer.persons.map((p) => p.id), canSeeCompany });
  const mine = viewer.spaces.find((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id);
  const summary: string[] = [];
  let moneyLine: Briefing["moneyLine"] = null;
  let incomplete = false;
  if (mine) {
    const v = buildPersonalView(viewer, mine.id);
    incomplete = !v.takeHome.takeHome.complete || v.food.foodTarget === null;
    if (v.food.foodTarget === null) summary.push(`Food this month so far: ${formatCents(v.food.foodSpentCents)} across ${v.data.shares.length ? "your shares of " : ""}${v.food.foodSpentCents ? "recorded meals" : "no recorded meals"}. No food target yet.`);
    else summary.push(`Food: ${formatCents(v.food.foodSpentCents)} of ${formatCents(v.food.foodTarget)} used this month; ${formatCents(v.food.foodRemainingCents!)} left.`);
    moneyLine = {
      label: v.takeHome.status === "verified" ? "Take-home" : v.takeHome.status === "estimate" ? "Take-home estimate" : "Take-home so far",
      value: v.takeHome.takeHome.complete ? formatCents(v.takeHome.takeHome.knownCents) : `${formatCents(v.takeHome.beforeIncomeTax.knownCents)} before income tax`,
      caveat: v.takeHome.status === "verified" ? null : v.takeHome.status === "estimate" ? "estimate, not a verified paycheck" : "income-tax withholding not confirmed",
    };
  }
  const upcoming = upcomingObligations(viewer, viewer.spaces.filter((sp) => sp.kind !== "personal" || sp.id === mine?.id).map((sp) => sp.id), 14).filter((o) => !o.paid).slice(0, 4);
  const attention = items.filter((i) => i.severity === "attention").slice(0, 3);
  return { greeting, personName: name, summary, nextStep: items[0] ?? null, attention, scope: "me", moneyLine, upcoming, asOf: todayIso(), isDemo: viewer.isDemo, incomplete };
}

export interface PartnerSummary {
  personId: string;
  name: string;
  month: string;
  foodTargetSet: boolean;
  foodStatus: FoodPlanResult["foodStatus"] | "not_shared";
  takeHomeStatus: "verified" | "estimate" | "incomplete" | "not_shared";
  /** Optional allocations to savings/investment, rounded to the nearest $50. */
  savingsAllocationRoundedCents: number | null;
  shared: boolean;
}

/**
 * Pre-approved aggregate fields only, at month granularity. No merchants,
 * dates, categories, amounts of individual purchases, or filters. Returns a
 * "not shared" summary when the partner has switched sharing off.
 */
export function buildPartnerSummary(viewer: Viewer, personId: string, month = currentMonth()): PartnerSummary | null {
  const person = viewer.persons.find((p) => p.id === personId);
  if (!person || person.id === viewer.person?.id) return null;
  const prefs = person.userId ? loadPreferences(person.userId) : null;
  if (!prefs || !prefs.sharePersonalSummary) return { personId, name: person.name, month, foodTargetSet: false, foodStatus: "not_shared", takeHomeStatus: "not_shared", savingsAllocationRoundedCents: null, shared: false };
  const o = ownerOf(viewer, personId);
  const takeHome = computeTakeHome(amountFromNullable(o.grossSalaryCents, "not set"), viewer.assumptions.payrollRules, o.withholding);
  // Food status needs the partner's shares; computed here server-side and reduced to a coarse status only.
  const partnerSpace = viewer.persons.find((p) => p.id === personId) ? { id: `partner-${personId}`, kind: "personal" as const, name: person.name, personId, role: "viewer" as const } : null;
  let foodStatus: PartnerSummary["foodStatus"] = "no_target";
  if (o.foodTargetCents !== null && partnerSpace) {
    const spent = partnerFoodSpent(viewer, personId, month);
    const remaining = o.foodTargetCents - spent;
    foodStatus = remaining < 0 ? "over" : remaining <= o.foodTargetCents * 0.15 ? "close" : "on_track";
  }
  const savings = o.allocations.filter((a) => a.kind !== "spending").reduce((a, x) => a + x.monthlyCents, 0);
  return { personId, name: person.name, month, foodTargetSet: o.foodTargetCents !== null, foodStatus, takeHomeStatus: takeHome.status, savingsAllocationRoundedCents: savings ? Math.round(savings / 5000) * 5000 : null, shared: true };
}

function partnerFoodSpent(viewer: Viewer, personId: string, month: string): number {
  // Only the total of the partner's food shares for the month leaves this function.
  void viewer;
  const period = monthPeriod(month);
  const rows = getDb().select({ cents: expenseShares.cents }).from(expenseShares).where(and(eq(expenseShares.personId, personId), gte(expenseShares.date, period.from), lte(expenseShares.date, period.to))).all();
  return rows.reduce((a, r) => a + r.cents, 0);
}

export function totalOrUnknown(t: Total): Amount {
  return t.complete ? known(t.knownCents) : unknown(t.unknowns.join("; "));
}

export { total };
