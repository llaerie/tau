/**
 * Synthetic payroll: monthly runs for the three US employees on the last business day, one
 * net-pay bank transaction per employee, accrued PayrollLiability records and their remittance
 * the following month (federal monthly, state PIT/SDI monthly, UI/ETT quarterly, FUTA annually).
 *
 * Rates are SYNTHETIC LAB RATES. They are exported so tests and evals can recompute the maths,
 * but they are never an authoritative source.
 */
import { entryForPayrollLiabilityPayment, entryForPayrollRun } from "@/lib/accounting/posting-helpers";
import type { NewJournalLineInput } from "@/lib/core/contracts";
import { addMonths, monthEnd, nextBusinessDay, previousBusinessDay } from "@/lib/core/dates";
import { D, add, cents, money, mul, sub } from "@/lib/core/money";
import type { DecimalString, ISODate, PayrollLiability, PayrollLiabilityKind, PayrollLine, PayrollRun, Transaction, Worker } from "@/lib/core/types";
import { GENERATOR_ACTOR, acct, sid, type GenContext } from "./context";

export const SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS = {
  id: "rates_synthetic_lab_v1",
  label: "SYNTHETIC LAB RATES — NOT AUTHORITATIVE; real rates must come from an authoritative source",
  status: "UNCONFIRMED" as const,
  synthetic: true as const,
  socialSecurityEmployee: "0.062",
  socialSecurityEmployer: "0.062",
  medicareEmployee: "0.0145",
  medicareEmployer: "0.0145",
  futaRate: "0.006",
  futaWageBase: "7000",
  suiRate: "0.034",
  suiWageBase: "7000",
  ettRate: "0.001",
  ettWageBase: "7000",
  sdiEmployee: "0.011",
  federalWithholdingFlat: "0.12",
  stateWithholdingFlat: "0.04",
} as const;

const R = SYNTHETIC_PAYROLL_RATE_ASSUMPTIONS;
const LIABILITY_GL: Record<PayrollLiabilityKind, string> = {
  FEDERAL_WITHHOLDING_AND_FICA: "2200",
  STATE_WITHHOLDING_AND_SDI: "2210",
  FEDERAL_UNEMPLOYMENT: "2220",
  STATE_UNEMPLOYMENT_AND_ETT: "2230",
  OTHER: "2150",
};

const pct = (base: DecimalString | number, rate: string): DecimalString => money(cents(mul(base, rate)));

/** Compute one payroll line. `ytdWages` are calendar-year wages before this run (for the 7,000 bases). */
export function computePayrollLine(worker: Worker, gross: DecimalString, ytdWages: DecimalString): PayrollLine {
  const base = (wageBase: string): DecimalString => {
    const room = D(wageBase).minus(D(ytdWages));
    if (room.lte(0)) return money(0);
    return room.gt(D(gross)) ? money(gross) : money(room);
  };
  const fit = pct(gross, R.federalWithholdingFlat);
  const sit = pct(gross, R.stateWithholdingFlat);
  const ssEe = pct(gross, R.socialSecurityEmployee);
  const medEe = pct(gross, R.medicareEmployee);
  const sdi = pct(gross, R.sdiEmployee);
  const other = money(0);
  const net = sub(sub(sub(sub(sub(sub(gross, fit), sit), ssEe), medEe), sdi), other);
  const ssEr = pct(gross, R.socialSecurityEmployer);
  const medEr = pct(gross, R.medicareEmployer);
  const futa = pct(base(R.futaWageBase), R.futaRate);
  const sui = pct(base(R.suiWageBase), R.suiRate);
  const ett = pct(base(R.ettWageBase), R.ettRate);
  const otherEr = money(0);
  return {
    workerId: worker.id,
    gross: money(gross),
    federalIncomeTaxWithheld: fit,
    stateIncomeTaxWithheld: sit,
    socialSecurityEmployee: ssEe,
    medicareEmployee: medEe,
    stateDisabilityEmployee: sdi,
    otherDeductions: other,
    netPay: net,
    socialSecurityEmployer: ssEr,
    medicareEmployer: medEr,
    federalUnemploymentEmployer: futa,
    stateUnemploymentEmployer: sui,
    stateTrainingTaxEmployer: ett,
    otherEmployerCosts: otherEr,
    totalEmployerCost: add(gross, ssEr, medEr, futa, sui, ett, otherEr),
  };
}

export function payrollTotals(lines: PayrollLine[]): PayrollRun["totals"] {
  const sum = (f: (l: PayrollLine) => DecimalString) => add(...(lines.length ? lines.map(f) : [0]));
  return {
    gross: sum((l) => l.gross),
    employeeTaxes: sum((l) => add(l.federalIncomeTaxWithheld, l.stateIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.stateDisabilityEmployee)),
    otherDeductions: sum((l) => l.otherDeductions),
    netPay: sum((l) => l.netPay),
    employerTaxes: sum((l) => add(l.socialSecurityEmployer, l.medicareEmployer, l.federalUnemploymentEmployer, l.stateUnemploymentEmployer, l.stateTrainingTaxEmployer)),
    totalEmployerCost: sum((l) => l.totalEmployerCost),
  };
}

const initials = (name: string) => name.split(/\s+/).map((p) => p[0]?.toUpperCase() ?? "").join("");

function liabilityAmounts(lines: PayrollLine[]): Record<Exclude<PayrollLiabilityKind, "OTHER">, DecimalString> {
  const sum = (f: (l: PayrollLine) => DecimalString[]) => add(...lines.flatMap(f));
  return {
    FEDERAL_WITHHOLDING_AND_FICA: sum((l) => [l.federalIncomeTaxWithheld, l.socialSecurityEmployee, l.medicareEmployee, l.socialSecurityEmployer, l.medicareEmployer]),
    STATE_WITHHOLDING_AND_SDI: sum((l) => [l.stateIncomeTaxWithheld, l.stateDisabilityEmployee]),
    FEDERAL_UNEMPLOYMENT: sum((l) => [l.federalUnemploymentEmployer]),
    STATE_UNEMPLOYMENT_AND_ETT: sum((l) => [l.stateUnemploymentEmployer, l.stateTrainingTaxEmployer]),
  };
}

/** Remit one or more liabilities of the same GL account with a single bank transaction. */
function remit(ctx: GenContext, key: string, date: ISODate, description: string, authority: string, liabilities: PayrollLiability[], caseKeys: string[]): Transaction | null {
  const open = liabilities.filter((l) => D(l.amount).gt(0));
  if (!open.length || !ctx.inRange(date)) return null;
  const total = add(...open.map((l) => l.amount));
  const glCode = ctx.ds.accounts.find((a) => a.id === open[0].glAccountId)?.code ?? "2200";
  const tx = ctx.addTx({
    key: `bank:${key}`,
    source: "checking",
    date,
    amount: `-${total}`,
    description,
    counterparty: { type: "TAX_AUTHORITY", id: authority },
    categoryCode: glCode,
    reason: `Payroll tax remittance — settles accrued liability ${glCode}`,
  });
  for (const l of open) {
    l.status = "PAID";
    l.paidTransactionId = tx.id;
  }
  const entryId = sid("je", `tx:${tx.id}`);
  ctx.schedule(date, (ledger) => {
    const input =
      open.length === 1
        ? entryForPayrollLiabilityPayment(open[0], "1000", date, { id: entryId, post: true, description: `Payroll tax remittance: ${description}` })
        : {
            id: entryId,
            date,
            description: `Payroll tax remittance: ${description} (${open.length} payroll runs)`,
            source: "PAYROLL" as const,
            lines: [
              ...open.map<NewJournalLineInput>((l) => ({ accountId: l.glAccountId, debit: l.amount, memo: `${l.kind} run ${l.payrollRunId}`, entityRef: { type: "TAX_AUTHORITY" as const, id: authority } })),
              { accountCode: "1000", credit: total },
            ],
            sourceIds: [...open.map((l) => l.id), ...open.map((l) => l.payrollRunId), tx.id],
            tags: ["payroll-liability-payment"],
            post: true,
          };
    ctx.link(tx, ledger.createEntry(input, GENERATOR_ACTOR));
  });
  for (const k of caseKeys) ctx.caseTx(k, tx);
  ctx.caseEntity("payroll_tax_liabilities", ...open.map((l) => l.id));
  return tx;
}

export function generatePayroll(ctx: GenContext): void {
  const { owner, finance, engineer } = ctx.refs.workers;
  const employees = [owner, finance, engineer];
  const ytd = new Map<string, DecimalString>();
  const byQuarter = new Map<string, PayrollLiability[]>();
  const byYear = new Map<number, PayrollLiability[]>();
  let firstFederalDeposit = true;

  for (const month of ctx.months) {
    const payDate = previousBusinessDay(monthEnd(`${month}-01`));
    if (!ctx.inRange(payDate)) continue;
    const year = Number(month.slice(0, 4));
    const runId = sid("pr", month);

    const lines = employees.map((w) => {
      const key = `${w.id}:${year}`;
      const before = ytd.get(key) ?? money(0);
      const line = computePayrollLine(w, w.compensation.amount, before);
      ytd.set(key, add(before, line.gross));
      return line;
    });

    const netPayTxs = employees.map((w, i) => {
      const tx = ctx.addTx({
        key: `bank:${month}:net-pay:${w.id}`,
        source: "checking",
        date: payDate,
        amount: `-${lines[i].netPay}`,
        description: `PAYROLL NET PAY - ${initials(w.displayName)}`,
        merchant: "Paystream Payroll Services",
        counterparty: { type: w.isOwner ? "OWNER" : "EMPLOYEE", id: w.id },
        categoryCode: w.isOwner ? "6010" : "6000",
        reason: `Payroll net pay — posted through payroll run ${month}`,
        flags: w.relatedParty ? ["RELATED_PARTY"] : [],
        meta: { payrollRunId: runId, workerId: w.id },
      });
      ctx.caseTx("payroll_net_pay", tx);
      if (w.isOwner) ctx.caseTx("owner_wage", tx);
      return tx;
    });

    const run: PayrollRun = {
      id: runId,
      periodStart: `${month}-01`,
      periodEnd: monthEnd(`${month}-01`),
      payDate,
      currency: "USD",
      providerRef: `PAYSTREAM-${month.replace("-", "")}`,
      status: month < ctx.priorMonth ? "RECONCILED" : "PAID",
      lines,
      totals: payrollTotals(lines),
      netPayTransactionIds: netPayTxs.map((t) => t.id),
      rateAssumptionSetId: R.id,
      reconciliation: { status: "MATCHED", varianceAmount: money(0), notes: ["Net pay matched to bank transactions (synthetic)."] },
    };
    ctx.ds.payrollRuns.push(run);
    ctx.caseEntity("payroll_net_pay", run.id);
    ctx.caseEntity("owner_wage", owner.id, run.id);

    const amounts = liabilityAmounts(lines);
    const liabilities = (Object.keys(amounts) as (keyof typeof amounts)[])
      .filter((k) => D(amounts[k]).gt(0))
      .map<PayrollLiability>((kind) => ({
        id: sid("pl", month, kind),
        payrollRunId: runId,
        kind,
        amount: amounts[kind],
        currency: "USD",
        accruedDate: payDate,
        dueDate: null,
        status: "ACCRUED",
        glAccountId: acct(LIABILITY_GL[kind]),
      }));
    ctx.ds.payrollLiabilities.push(...liabilities);
    ctx.caseEntity("payroll_tax_liabilities", ...liabilities.map((l) => l.id));

    const entryId = sid("je", `payroll:${month}`);
    ctx.schedule(payDate, (ledger) => {
      const entry = ledger.createEntry(entryForPayrollRun(run, employees, "1000", { id: entryId, post: true, sourceIds: liabilities.map((l) => l.id) }), GENERATOR_ACTOR);
      run.journalEntryId = entry.id;
      for (const tx of netPayTxs) ctx.link(tx, entry);
    });

    ctx.addDoc({
      key: `payroll-report:${month}`,
      kind: "PAYROLL_REPORT",
      title: `Payroll register ${month} (Paystream)`,
      date: payDate,
      amount: run.totals.gross,
      transactionIds: netPayTxs.map((t) => t.id),
      journalEntryIds: [entryId],
      storagePath: `synthetic://payroll/register-${month}.pdf`,
      extracted: { payrollRunId: runId, gross: run.totals.gross, netPay: run.totals.netPay, employerTaxes: run.totals.employerTaxes, employees: employees.length, rateAssumptionSetId: R.id },
      tags: ["payroll"],
    });

    // Remittances the following month.
    const next = addMonths(`${month}-01`, 1).slice(0, 7);
    const fed = liabilities.find((l) => l.kind === "FEDERAL_WITHHOLDING_AND_FICA");
    const state = liabilities.find((l) => l.kind === "STATE_WITHHOLDING_AND_SDI");
    if (fed) {
      const tx = remit(ctx, `${next}:irs-deposit`, nextBusinessDay(`${next}-15`), "IRS USATAXPYMT", "irs", [fed], ["payroll_tax_liabilities"]);
      if (tx && firstFederalDeposit) {
        ctx.caseTx("payroll_tax_deposit", tx);
        ctx.caseEntity("payroll_tax_deposit", fed.id, runId);
        firstFederalDeposit = false;
      }
    }
    if (state) remit(ctx, `${next}:edd-deposit`, nextBusinessDay(`${next}-15`), "EDD EFT PAYMENT", "ca_edd", [state], ["payroll_tax_liabilities"]);
    const sui = liabilities.find((l) => l.kind === "STATE_UNEMPLOYMENT_AND_ETT");
    if (sui) {
      const q = `${year}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;
      byQuarter.set(q, [...(byQuarter.get(q) ?? []), sui]);
    }
    const futa = liabilities.find((l) => l.kind === "FEDERAL_UNEMPLOYMENT");
    if (futa) byYear.set(year, [...(byYear.get(year) ?? []), futa]);
  }

  for (const [q, liabs] of byQuarter) {
    const year = Number(q.slice(0, 4));
    const quarter = Number(q.slice(6));
    const payMonth = addMonths(`${year}-${String(quarter * 3).padStart(2, "0")}-01`, 1).slice(0, 7);
    remit(ctx, `${payMonth}:edd-ui-ett`, previousBusinessDay(`${payMonth}-28`), "EDD EFT PAYMENT UI/ETT", "ca_edd", liabs, ["payroll_tax_liabilities"]);
  }
  for (const [year, liabs] of byYear) {
    remit(ctx, `${year + 1}-01:irs-futa`, previousBusinessDay(`${year + 1}-01-31`), "IRS USATAXPYMT FUTA 940", "irs", liabs, ["payroll_tax_liabilities"]);
  }
}
