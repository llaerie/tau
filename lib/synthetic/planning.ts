/**
 * Planning seeds: an approved operating budget for the current fiscal year and the prior one,
 * and TaxObligation records whose due dates are deliberately unknown (tax rules are data owned
 * by the knowledge layer, not seeded here). Forecasts and scenarios are left empty.
 */
import { money } from "@/lib/core/money";
import type { Assumption, Budget, BudgetLine, TaxObligation } from "@/lib/core/types";
import { OWNER_ACTOR, acct, sid, ts, type GenContext } from "./context";

interface BudgetPattern {
  code: string;
  monthly?: string;
  quarterEnd?: string;
  months?: Record<number, string>;
}

const BUDGET_PATTERN: BudgetPattern[] = [
  { code: "4000", monthly: "30000" },
  { code: "4100", monthly: "2000" },
  { code: "5000", monthly: "1850" },
  { code: "5100", monthly: "1500" },
  { code: "6000", monthly: "8500" },
  { code: "6010", monthly: "3000" },
  { code: "6060", monthly: "3000" },
  { code: "6100", monthly: "900" },
  { code: "6190", monthly: "60" },
  { code: "7000", monthly: "413.50" },
  { code: "7100", monthly: "450" },
  { code: "7150", monthly: "89" },
  { code: "7200", quarterEnd: "350" },
  { code: "7250", monthly: "145" },
  { code: "7300", monthly: "120" },
  { code: "7400", monthly: "85" },
  { code: "7450", monthly: "95" },
  { code: "7500", monthly: "25" },
  { code: "7700", monthly: "80.53" },
  { code: "7900", months: { 4: "800" } },
];

function budgetLines(fiscalYear: number, fromMonth: number): BudgetLine[] {
  const lines: BudgetLine[] = [];
  for (let m = fromMonth; m <= 12; m++) {
    const month = `${fiscalYear}-${String(m).padStart(2, "0")}`;
    for (const p of BUDGET_PATTERN) {
      const amount = p.monthly ?? (p.quarterEnd && m % 3 === 0 ? p.quarterEnd : undefined) ?? p.months?.[m];
      if (!amount) continue;
      lines.push({ accountId: acct(p.code), month, amount: money(amount), driverKey: p.code === "4000" ? "retainer_monthly_fee" : undefined, note: "Synthetic recurring pattern" });
    }
  }
  return lines;
}

function budgetAssumptions(): Assumption[] {
  return [
    { key: "retainer_monthly_fee", description: "Harbor Analytics retainer continues at 30,000/month (related-party contract)", value: "30000", status: "UNCONFIRMED", requiresProfessionalReview: false },
    { key: "headcount", description: "Three US employees on payroll; two China-based workers at 1,500/month (classification unresolved)", value: 5, status: "UNCONFIRMED", requiresProfessionalReview: true },
    { key: "synthetic", description: "SYNTHETIC LAB BUDGET — numbers are lab figures, not a real plan", value: true, status: "CONFIRMED" },
  ];
}

export function generatePlanning(ctx: GenContext): void {
  const fy = Number(ctx.asOf.slice(0, 4));
  const startYear = Number(ctx.startMonth.slice(0, 4));
  const startMonthNum = Number(ctx.startMonth.slice(5, 7));

  const current: Budget = {
    id: sid("bud", fy),
    name: `FY${fy} Operating Budget (SYNTHETIC)`,
    fiscalYear: fy,
    version: 1,
    status: "APPROVED",
    lines: budgetLines(fy, startYear === fy ? startMonthNum : 1),
    assumptions: budgetAssumptions(),
    approvedBy: OWNER_ACTOR.id,
    approvedAt: ts(`${fy - 1}-12-15`, 16),
    createdAt: ts(`${fy - 1}-12-01`, 10),
  };
  ctx.ds.budgets.push(current);
  if (startYear < fy) {
    const prior: Budget = {
      id: sid("bud", fy - 1),
      name: `FY${fy - 1} Operating Budget (SYNTHETIC)`,
      fiscalYear: fy - 1,
      version: 1,
      status: "APPROVED",
      lines: budgetLines(fy - 1, startYear === fy - 1 ? startMonthNum : 1),
      assumptions: budgetAssumptions(),
      approvedBy: OWNER_ACTOR.id,
      approvedAt: ts(`${ctx.startMonth}-01`, 16),
      createdAt: ts(`${ctx.startMonth}-01`, 10),
    };
    ctx.ds.budgets.push(prior);
  }

  generateTaxObligations(ctx);
}

const UNKNOWN_DUE_NOTE = "Due date and amount must come from a current authoritative tax rule; none is seeded in the synthetic dataset.";

function generateTaxObligations(ctx: GenContext): void {
  const fy = Number(ctx.asOf.slice(0, 4));
  const priorYear = fy - 1;
  const obligations: TaxObligation[] = [];
  const base = (partial: Omit<TaxObligation, "currency" | "amount" | "documentIds" | "dueDate" | "status"> & Partial<TaxObligation>): TaxObligation => ({
    currency: "USD",
    amount: null,
    dueDate: null,
    status: "UNKNOWN",
    documentIds: [],
    ...partial,
  });

  obligations.push(
    base({ id: sid("tax", "1120s", priorYear), jurisdiction: "FEDERAL", kind: "FORM_1120S", title: `Federal S corporation return (Form 1120-S) FY${priorYear}`, description: "Annual federal income tax return for the S corporation.", taxYear: priorYear, requiresCpaReview: true, notes: [UNKNOWN_DUE_NOTE] }),
    base({ id: sid("tax", "100s", priorYear), jurisdiction: "CALIFORNIA", kind: "CA_FORM_100S", title: `California S corporation return (Form 100S) FY${priorYear}`, description: "Annual California franchise or income tax return for the S corporation.", taxYear: priorYear, requiresCpaReview: true, notes: [UNKNOWN_DUE_NOTE] }),
    base({ id: sid("tax", "940", priorYear), jurisdiction: "FEDERAL", kind: "FORM_940", title: `Annual federal unemployment return (Form 940) ${priorYear}`, description: "Annual FUTA return.", taxYear: priorYear, requiresCpaReview: false, notes: [UNKNOWN_DUE_NOTE] }),
    base({ id: sid("tax", "1099", priorYear), jurisdiction: "FEDERAL", kind: "1099_NEC", title: `1099 information returns ${priorYear} — China-based workers`, description: "Whether information returns (1099-NEC) or W-8 documentation apply to the two China-based workers is unresolved.", taxYear: priorYear, requiresCpaReview: true, status: "NOT_APPLICABLE_PENDING_REVIEW", notes: ["worker classification unresolved", "No W-9 / W-8 on file for either China-based worker; domestic contractor Pixel Forge Design also lacks a W-9."] }),
  );

  // Quarterly payroll returns for every quarter with a payroll run in the timeline.
  const quarters = new Set<string>();
  for (const run of ctx.ds.payrollRuns) quarters.add(`${run.payDate.slice(0, 4)}-Q${Math.floor((Number(run.payDate.slice(5, 7)) - 1) / 3) + 1}`);
  for (const q of [...quarters].sort()) {
    const year = Number(q.slice(0, 4));
    obligations.push(
      base({ id: sid("tax", "941", q), jurisdiction: "FEDERAL", kind: "FORM_941", title: `Form 941 — ${q}`, description: "Quarterly federal payroll tax return.", taxYear: year, periodLabel: q, requiresCpaReview: false, notes: [UNKNOWN_DUE_NOTE] }),
      base({ id: sid("tax", "de9", q), jurisdiction: "CALIFORNIA", kind: "CA_DE9", title: `California DE 9 / DE 9C — ${q}`, description: "Quarterly California payroll tax return.", taxYear: year, periodLabel: q, requiresCpaReview: false, notes: [UNKNOWN_DUE_NOTE] }),
    );
  }

  const ftbTxId = ctx.requireMark("franchise-tax-tx");
  const ftbTx = ctx.ds.transactions.find((t) => t.id === ftbTxId);
  if (ftbTx) {
    obligations.push(
      base({
        id: sid("tax", "ca-franchise", ftbTx.date.slice(0, 4)),
        jurisdiction: "CALIFORNIA",
        kind: "CA_FRANCHISE_TAX",
        title: `California franchise tax payment ${ftbTx.date.slice(0, 4)}`,
        description: "Payment recorded from the bank feed to the Franchise Tax Board.",
        taxYear: Number(ftbTx.date.slice(0, 4)),
        amount: money(Number(ftbTx.amount) * -1),
        status: "PAID",
        requiresCpaReview: true,
        ruleSourceId: undefined,
        notes: ["amount taken from bank record, not from a rule", `Transaction ${ftbTx.id}`],
      }),
    );
  }
  ctx.ds.taxObligations.push(...obligations);
}
