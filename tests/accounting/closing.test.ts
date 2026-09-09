import { describe, expect, it } from "vitest";
import { ControlViolationError } from "@/lib/core/errors";
import { add, neg, sub } from "@/lib/core/money";
import { applyCorrection, buildClosingEntries, buildCorrectingEntry } from "@/lib/accounting/closing";
import { acct, actor, makeLedger } from "./fixture";

const simple = (date: string, debit: string, credit: string, amount: string, source: "MANUAL" | "OPENING_BALANCE" = "MANUAL") => ({
  date,
  description: `${debit}/${credit} ${amount}`,
  source,
  lines: [{ accountCode: debit, debit: amount }, { accountCode: credit, credit: amount }],
  post: true,
});

describe("Reversals and correcting entries", () => {
  it("reverseEntry creates a posted mirror entry, links both, and nets balances to zero", () => {
    const { ledger } = makeLedger();
    const original = ledger.createEntry({ ...simple("2026-04-03", "7300", "1000", "120.45"), memo: "lunch" }, actor);
    const rev = ledger.reverseEntry(original.id, "2026-04-04", actor, "Personal expense");
    expect(rev.source).toBe("REVERSAL");
    expect(rev.status).toBe("POSTED");
    expect(rev.reversesEntryId).toBe(original.id);
    expect(rev.sourceIds).toContain(original.id);
    expect(rev.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [acct("7300"), "0.0000", "120.4500"],
      [acct("1000"), "120.4500", "0.0000"],
    ]);
    expect(original.status).toBe("REVERSED");
    expect(original.reversedByEntryId).toBe(rev.id);
    expect(ledger.accountBalance(acct("7300"), "2026-04-30")).toBe("0.0000");
    expect(ledger.accountBalance(acct("1000"), "2026-04-30")).toBe("0.0000");
    // History is preserved: as of the original date the expense still shows.
    expect(ledger.accountBalance(acct("7300"), "2026-04-03")).toBe("120.4500");
    expect(() => ledger.reverseEntry(original.id, "2026-04-05", actor, "twice")).toThrow(ControlViolationError);
    expect(ledger.runIntegrityChecks("2026-04-30").checks.find((c) => c.key === "reversal-links")!.passed).toBe(true);
  });

  it("only POSTED entries can be reversed and a reason is required", () => {
    const { ledger } = makeLedger();
    const draft = ledger.createEntry({ ...simple("2026-04-03", "7300", "1000", "1"), post: false }, actor);
    expect(() => ledger.reverseEntry(draft.id, "2026-04-04", actor, "x")).toThrow(ControlViolationError);
    const posted = ledger.createEntry(simple("2026-04-03", "7300", "1000", "1"), actor);
    expect(() => ledger.reverseEntry(posted.id, "2026-04-04", actor, "")).toThrow(ControlViolationError);
  });

  it("buildCorrectingEntry yields a CORRECTING reversal + re-entry pair; applyCorrection posts them", () => {
    const { ledger } = makeLedger();
    ledger.createEntry(simple("2026-01-05", "1000", "3000", "10000", "OPENING_BALANCE"), actor);
    const wrong = ledger.createEntry(simple("2026-01-20", "7300", "1000", "900"), actor); // should have been software
    ledger.softClosePeriod("2026-01", actor);

    const pair = buildCorrectingEntry(wrong, {
      date: "2026-01-31",
      reason: "Miscoded: software subscription, not meals",
      lines: [{ accountCode: "7000", debit: "900" }, { accountCode: "1000", credit: "900" }],
      idPrefix: "je_fix1",
    });
    expect(pair.reversal.source).toBe("CORRECTING");
    expect(pair.reentry.source).toBe("CORRECTING");
    expect(pair.reversal.tags).toContain("prior-period-correction");
    expect(pair.reentry.tags).toContain("prior-period-correction");
    expect(pair.reversal.id).toBe("je_fix1_rev");
    expect(pair.reversal.lines).toEqual([
      { accountId: acct("7300"), debit: "0.0000", credit: "900.0000", memo: undefined, entityRef: undefined },
      { accountId: acct("1000"), debit: "900.0000", credit: "0.0000", memo: undefined, entityRef: undefined },
    ]);

    const { reversal, reentry } = applyCorrection(ledger, wrong, { date: "2026-01-31", reason: "Miscoded", lines: pair.reentry.lines, idPrefix: "je_fix1" }, actor);
    expect(reversal.source).toBe("CORRECTING");
    expect(reversal.status).toBe("POSTED");
    expect(reversal.id).toBe("je_fix1_rev");
    expect(reentry.id).toBe("je_fix1_new");
    expect(reentry.status).toBe("POSTED");
    expect(wrong.status).toBe("REVERSED");
    expect(wrong.reversedByEntryId).toBe(reversal.id);
    expect(ledger.accountBalance(acct("7300"), "2026-01-31")).toBe("0.0000");
    expect(ledger.accountBalance(acct("7000"), "2026-01-31")).toBe("900.0000");
    expect(ledger.accountBalance(acct("1000"), "2026-01-31")).toBe("9100.0000");
    expect(ledger.balanceSheet("2026-01-31").balanced).toBe(true);
  });
});

describe("Year-end closing entries", () => {
  function yearOfActivity() {
    const { ledger, ds } = makeLedger();
    ledger.createEntry(simple("2025-01-05", "1000", "3000", "20000", "OPENING_BALANCE"), actor);
    ledger.createEntry(simple("2025-03-01", "1000", "4000", "15000"), actor);
    ledger.createEntry(simple("2025-05-01", "1100", "4100", "2500.75"), actor);
    ledger.createEntry(simple("2025-06-01", "7100", "1000", "6000"), actor);
    ledger.createEntry(simple("2025-08-01", "5000", "2050", "1200.25"), actor);
    ledger.createEntry(simple("2025-11-15", "3100", "1000", "3000"), actor);
    return { ledger, ds };
  }

  it("rolls P&L and distributions into retained earnings, leaving P&L at zero", () => {
    const { ledger } = yearOfActivity();
    const before = ledger.incomeStatement("2025-01-01", "2025-12-31");
    expect(before.netIncome).toBe("10300.5000"); // 15000 + 2500.75 − 6000 − 1200.25

    const entries = buildClosingEntries(ledger, 2025, { idPrefix: "je_close_2025", post: true });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.source === "CLOSING" && e.date === "2025-12-31")).toBe(true);
    for (const e of entries) ledger.createEntry(e, actor);

    for (const code of ["4000", "4100", "5000", "7100", "3100"]) {
      expect(ledger.accountBalance(acct(code), "2025-12-31")).toBe("0.0000");
    }
    expect(ledger.accountBalance(acct("3900"), "2025-12-31")).toBe(sub("10300.50", "3000"));
    // The income statement still reports the year's activity (closing entries excluded).
    expect(ledger.incomeStatement("2025-01-01", "2025-12-31").netIncome).toBe("10300.5000");
    // Running the close again produces nothing.
    expect(buildClosingEntries(ledger, 2025)).toEqual([]);

    const bs = ledger.balanceSheet("2025-12-31");
    expect(bs.balanced).toBe(true);
    expect(bs.currentYearEarnings).toBe("0.0000");
    expect(bs.lines.find((l) => l.label === "Retained Earnings")!.amount).toBe("7300.5000");
    expect(bs.totalEquity).toBe(add("20000", "7300.50"));
    // The next year starts clean and cash flow for that year still reconciles.
    expect(ledger.incomeStatement("2026-01-01", "2026-12-31").netIncome).toBe("0.0000");
    expect(ledger.cashFlowStatement("2025-01-01", "2025-12-31").reconciled).toBe(true);
    expect(ledger.cashFlowStatement("2025-01-01", "2025-12-31").financing).toBe(add("20000", neg("3000")));
  });

  it("balance sheet rolls unclosed prior-year earnings into retained earnings automatically", () => {
    const { ledger } = yearOfActivity();
    ledger.createEntry(simple("2026-02-01", "1000", "4000", "500"), actor);
    const bs = ledger.balanceSheet("2026-02-28");
    expect(bs.balanced).toBe(true);
    expect(bs.lines.find((l) => l.label === "Retained Earnings")!.amount).toBe("10300.5000");
    expect(bs.currentYearEarnings).toBe("500.0000");
    expect(bs.lines.find((l) => l.label === "Shareholder Distributions")!.amount).toBe("-3000.0000");
    expect(bs.totalEquity).toBe(add("20000", "10300.50", "500", neg("3000")));
    // Closing the prior year afterwards leaves equity unchanged in total.
    for (const e of buildClosingEntries(ledger, 2025, { post: true })) ledger.createEntry(e, actor);
    const after = ledger.balanceSheet("2026-02-28");
    expect(after.totalEquity).toBe(bs.totalEquity);
    expect(after.lines.find((l) => l.label === "Retained Earnings")!.amount).toBe("7300.5000");
    expect(after.balanced).toBe(true);
  });

  it("closes a net loss with a debit to retained earnings", () => {
    const { ledger } = makeLedger();
    ledger.createEntry(simple("2025-01-05", "1000", "3000", "5000", "OPENING_BALANCE"), actor);
    ledger.createEntry(simple("2025-04-01", "7000", "1000", "800"), actor);
    const [close] = buildClosingEntries(ledger, 2025);
    const reLine = close.lines.find((l) => l.accountId === acct("3900"))!;
    expect(reLine.debit).toBe("800.0000");
    ledger.createEntry({ ...close, post: true }, actor);
    expect(ledger.accountBalance(acct("3900"), "2025-12-31")).toBe("-800.0000");
  });
});
