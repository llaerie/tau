/**
 * Ledger integrity checks. Pure read-only diagnostics over a `Ledger`; used by period locking
 * (ERROR-severity failures block a lock) and by the month-end close workflow.
 */
import Decimal from "decimal.js";
import { D, money, within } from "@/lib/core/money";
import type { IntegrityCheck, IntegrityReport } from "@/lib/core/contracts";
import type { ISODate } from "@/lib/core/types";
import { ACCT } from "./chart-of-accounts";
import type { Ledger } from "./ledger";
import { fiscalYearStart } from "./periods";
import { entryBalances, hasPostedEffect, movements, movementOf, signedBalance, sumSigned } from "./statements";

const TOL = "0.005";

export function runIntegrityChecks(ledger: Ledger, asOf: ISODate): IntegrityReport {
  const ds = ledger.dataset;
  const checks: IntegrityCheck[] = [];
  const push = (key: string, label: string, passed: boolean, severity: IntegrityCheck["severity"], details?: string) =>
    checks.push({ key, label, passed, severity, details });

  const posted = ds.journalEntries.filter((e) => hasPostedEffect(e) && e.date <= asOf);

  // 1. Every posted entry balances.
  const unbalanced = posted.filter((e) => !entryBalances(e));
  push("entries-balance", "Every posted journal entry balances", unbalanced.length === 0, "ERROR", unbalanced.length ? `Unbalanced: ${unbalanced.map((e) => `#${e.entryNumber}`).join(", ")}` : undefined);

  // 2. Trial balance balances.
  const tb = ledger.trialBalance(asOf);
  push("trial-balance", "Trial balance debits equal credits", tb.balanced, "ERROR", tb.balanced ? undefined : `Debits ${tb.totalDebits} vs credits ${tb.totalCredits}`);

  // 3. Balance sheet balances.
  const bs = ledger.balanceSheet(asOf);
  push("balance-sheet", "Assets equal liabilities plus equity", bs.balanced, "ERROR", bs.balanced ? undefined : `Difference ${bs.difference}`);

  // 4. Cash flow reconciles for fiscal year to date.
  const cf = ledger.cashFlowStatement(fiscalYearStart(asOf), asOf);
  push("cash-flow", "Cash flow statement reconciles to cash balances (fiscal YTD)", cf.reconciled, "ERROR", cf.reconciled ? undefined : `Opening ${cf.openingCash} + net change ${cf.netChange} != closing ${cf.closingCash}`);

  // 5. Suspense is zero at the end of every locked period.
  const locked = ds.periods.filter((p) => p.status === "LOCKED");
  const suspenseAcct = ledger.getAccount(ACCT.SUSPENSE);
  const suspenseViolations = suspenseAcct
    ? locked.filter((p) => !within(ledger.accountBalance(suspenseAcct.id, p.endDate), 0, TOL)).map((p) => p.id)
    : [];
  push("suspense-locked", "Suspense account is zero for every locked period", suspenseViolations.length === 0, "ERROR", suspenseViolations.length ? `Non-zero suspense in: ${suspenseViolations.join(", ")}` : undefined);

  // 6. No entries posted into a locked period after it was locked.
  const lockedById = new Map(locked.map((p) => [p.id, p]));
  const lateEntries = ds.journalEntries.filter((e) => {
    const p = lockedById.get(e.periodId);
    return p && hasPostedEffect(e) && e.postedAt && p.lockedAt && e.postedAt > p.lockedAt;
  });
  push("locked-period-posting", "No entries posted into a period after it was locked", lateEntries.length === 0, "ERROR", lateEntries.length ? `Posted after lock: ${lateEntries.map((e) => `#${e.entryNumber}`).join(", ")}` : undefined);

  // 7. Accumulated depreciation never exceeds fixed-asset cost.
  const map = movements(ds.journalEntries, { to: asOf });
  const fixedCost = sumSigned(ds.accounts.filter((a) => a.subtype === "FIXED_ASSET"), map);
  const accum = sumSigned(ds.accounts.filter((a) => a.subtype === "ACCUMULATED_DEPRECIATION"), map).neg(); // debit-normal contra → positive = accumulated
  const deprOk = accum.lte(fixedCost.plus(D(TOL)));
  push("accumulated-depreciation", "Accumulated depreciation does not exceed fixed-asset cost", deprOk, "ERROR", deprOk ? undefined : `Accumulated ${money(accum)} > cost ${money(fixedCost)}`);

  // 8. AR subledger vs GL (warning).
  const arAcct = ledger.getAccount(ACCT.AR);
  const openInvoices = ds.invoices.filter((i) => i.issueDate <= asOf && i.status !== "DRAFT" && i.status !== "VOID");
  if (arAcct && openInvoices.length) {
    const sub = openInvoices.reduce((acc, i) => acc.plus(D(i.total).minus(D(i.amountPaid))), new Decimal(0));
    const gl = D(ledger.accountBalance(arAcct.id, asOf));
    const ok = within(sub, gl, TOL);
    push("ar-subledger", "AR subledger equals AR general ledger balance", ok, "WARNING", ok ? undefined : `Subledger ${money(sub)} vs GL ${money(gl)}`);
  } else {
    push("ar-subledger", "AR subledger equals AR general ledger balance", true, "WARNING", "No invoices to reconcile");
  }

  // 9. AP subledger vs GL (warning).
  const apAcct = ledger.getAccount(ACCT.AP);
  const openBills = ds.bills.filter((b) => b.billDate <= asOf && b.status !== "VOID" && b.status !== "DUPLICATE");
  if (apAcct && openBills.length) {
    const sub = openBills.reduce((acc, b) => acc.plus(D(b.total).minus(D(b.amountPaid))), new Decimal(0));
    const gl = D(ledger.accountBalance(apAcct.id, asOf));
    const ok = within(sub, gl, TOL);
    push("ap-subledger", "AP subledger equals AP general ledger balance", ok, "WARNING", ok ? undefined : `Subledger ${money(sub)} vs GL ${money(gl)}`);
  } else {
    push("ap-subledger", "AP subledger equals AP general ledger balance", true, "WARNING", "No bills to reconcile");
  }

  // 10. Entry numbers are unique.
  const seen = new Map<number, number>();
  for (const e of ds.journalEntries) seen.set(e.entryNumber, (seen.get(e.entryNumber) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([num]) => num);
  push("entry-numbers-unique", "Journal entry numbers are unique", dupes.length === 0, "ERROR", dupes.length ? `Duplicates: ${dupes.join(", ")}` : undefined);

  // 11. Every posted line references an existing, active account.
  const badLines: string[] = [];
  for (const e of posted) {
    for (const l of e.lines) {
      const a = ledger.getAccount(l.accountId);
      if (!a) badLines.push(`#${e.entryNumber}: unknown account ${l.accountId}`);
      else if (!a.isActive) badLines.push(`#${e.entryNumber}: inactive account ${a.code}`);
    }
  }
  push("posted-lines-accounts", "Every posted line references an existing active account", badLines.length === 0, "ERROR", badLines.length ? badLines.slice(0, 10).join("; ") : undefined);

  // 12. Reversal links are consistent.
  const brokenReversals = ds.journalEntries.filter((e) => {
    if (e.status !== "REVERSED") return false;
    const r = e.reversedByEntryId ? ledger.getEntry(e.reversedByEntryId) : undefined;
    return !r || r.status !== "POSTED" || r.reversesEntryId !== e.id;
  });
  push("reversal-links", "Every reversed entry is offset by a posted reversal", brokenReversals.length === 0, "ERROR", brokenReversals.length ? `Broken: ${brokenReversals.map((e) => `#${e.entryNumber}`).join(", ")}` : undefined);

  // 13. Cash accounts are not overdrawn (warning — a real bank would bounce it).
  const negativeCash = ds.accounts.filter((a) => a.subtype === "CASH" && signedBalance(a, movementOf(map, a.id)).lt(D(TOL).neg()));
  push("cash-not-negative", "No cash account has a negative balance", negativeCash.length === 0, "WARNING", negativeCash.length ? `Overdrawn: ${negativeCash.map((a) => a.code).join(", ")}` : undefined);

  return { asOfDate: asOf, checks, passed: checks.every((c) => c.passed || c.severity === "WARNING") };
}
