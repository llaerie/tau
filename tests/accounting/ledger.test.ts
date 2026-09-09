import { describe, expect, it } from "vitest";
import { ControlViolationError, TauError, UnbalancedEntryError } from "@/lib/core/errors";
import { Ledger } from "@/lib/accounting/ledger";
import { acct, actor, makeLedger } from "./fixture";

describe("Ledger double-entry integrity", () => {
  it("throws UnbalancedEntryError when debits != credits and records nothing", () => {
    const { ledger, ds } = makeLedger();
    expect(() =>
      ledger.createEntry(
        { date: "2026-03-05", description: "bad", source: "MANUAL", lines: [{ accountCode: "1000", debit: "100.00" }, { accountCode: "4000", credit: "99.99" }] },
        actor,
      ),
    ).toThrow(UnbalancedEntryError);
    expect(ds.journalEntries).toHaveLength(0);
  });

  it("posts a balanced entry, resolves codes to ids, normalizes amounts and numbers sequentially", () => {
    const { ledger, persisted } = makeLedger();
    const e1 = ledger.createEntry(
      { date: "2026-03-05", description: "Capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: 1000 }, { accountCode: "3000", credit: "1000" }], post: true },
      actor,
    );
    const e2 = ledger.createEntry(
      { date: "2026-03-06", description: "Sale", source: "MANUAL", lines: [{ accountId: acct("1000"), debit: "250.5" }, { accountCode: "4000", credit: "250.50" }], post: true },
      actor,
    );
    expect(e1.status).toBe("POSTED");
    expect(e1.postedAt).toBeDefined();
    expect(e1.entryNumber).toBe(1);
    expect(e2.entryNumber).toBe(2);
    expect(e1.lines[0].accountId).toBe(acct("1000"));
    expect(e1.lines[0].debit).toBe("1000.0000");
    expect(e1.lines[0].credit).toBe("0.0000");
    expect(e2.lines[0].debit).toBe("250.5000");
    expect(e1.periodId).toBe("2026-03");
    expect(e1.lines.every((l) => l.currency === "USD")).toBe(true);
    expect(persisted).toContain("periods:2026-03");
    expect(persisted).toContain(`journalEntries:${e1.id}`);
    expect(ledger.accountBalance(acct("1000"), "2026-03-31")).toBe("1250.5000");
    expect(ledger.accountBalance(acct("4000"), "2026-03-31")).toBe("250.5000");
    expect(ledger.accountBalance(acct("3000"), "2026-03-31")).toBe("1000.0000");
    expect(ledger.accountBalance(acct("1000"), "2026-03-05")).toBe("1000.0000");
    expect(ledger.accountBalance(acct("1000"), "2026-03-31", "2026-03-06")).toBe("250.5000");
  });

  it("uses deterministic ids when provided and rejects duplicates", () => {
    const { ledger } = makeLedger();
    const e = ledger.createEntry({ id: "je_fixed", date: "2026-03-05", description: "x", source: "MANUAL", lines: [{ accountCode: "1000", debit: 1 }, { accountCode: "4000", credit: 1 }] }, actor);
    expect(e.id).toBe("je_fixed");
    expect(e.lines[0].id).toBe("je_fixed_l1");
    expect(() =>
      ledger.createEntry({ id: "je_fixed", date: "2026-03-05", description: "x", source: "MANUAL", lines: [{ accountCode: "1000", debit: 1 }, { accountCode: "4000", credit: 1 }] }, actor),
    ).toThrow(/already exists/);
  });

  it("rejects malformed lines: <2 lines, both debit and credit, neither, negative, unknown account", () => {
    const { ledger } = makeLedger();
    const base = { date: "2026-03-05", description: "x", source: "MANUAL" as const };
    expect(() => ledger.createEntry({ ...base, lines: [{ accountCode: "1000", debit: 1 }] }, actor)).toThrow(UnbalancedEntryError);
    expect(() => ledger.createEntry({ ...base, lines: [{ accountCode: "1000", debit: 1, credit: 1 }, { accountCode: "4000", credit: 0 }] }, actor)).toThrow(/exactly one/);
    expect(() => ledger.createEntry({ ...base, lines: [{ accountCode: "1000" }, { accountCode: "4000" }] }, actor)).toThrow(/exactly one/);
    expect(() => ledger.createEntry({ ...base, lines: [{ accountCode: "1000", debit: -5 }, { accountCode: "4000", debit: 5 }] }, actor)).toThrow(/negative/);
    expect(() => ledger.createEntry({ ...base, lines: [{ accountCode: "0000", debit: 5 }, { accountCode: "4000", credit: 5 }] }, actor)).toThrow(/Unknown account/);
  });

  it("rejects inactive accounts and tags restricted accounts", () => {
    const { ledger, ds } = makeLedger();
    ds.accounts.find((a) => a.code === "7010")!.isActive = false;
    expect(() =>
      ledger.createEntry({ date: "2026-03-05", description: "x", source: "MANUAL", lines: [{ accountCode: "7010", debit: 5 }, { accountCode: "1000", credit: 5 }] }, actor),
    ).toThrow(/inactive/);
    const e = ledger.createEntry({ date: "2026-03-05", description: "dist", source: "MANUAL", lines: [{ accountCode: "3100", debit: 5 }, { accountCode: "1000", credit: 5 }], tags: ["custom"] }, actor);
    expect(e.tags).toContain("restricted-account");
    expect(e.tags).toContain("custom");
  });

  it("creates drafts by default and posts them via postEntry; drafts do not affect balances", () => {
    const { ledger } = makeLedger();
    const e = ledger.createEntry({ date: "2026-03-05", description: "draft", source: "MANUAL", lines: [{ accountCode: "1000", debit: 10 }, { accountCode: "4000", credit: 10 }] }, actor);
    expect(e.status).toBe("DRAFT");
    expect(ledger.accountBalance(acct("1000"), "2026-03-31")).toBe("0.0000");
    const posted = ledger.postEntry(e.id, actor, "appr_1");
    expect(posted.status).toBe("POSTED");
    expect(posted.approvalId).toBe("appr_1");
    expect(ledger.accountBalance(acct("1000"), "2026-03-31")).toBe("10.0000");
    expect(() => ledger.postEntry(e.id, actor)).toThrow(ControlViolationError);
  });

  it("re-validates on post: a draft touching a since-deactivated account cannot be posted", () => {
    const { ledger, ds } = makeLedger();
    const e = ledger.createEntry({ date: "2026-03-05", description: "draft", source: "MANUAL", lines: [{ accountCode: "7000", debit: 10 }, { accountCode: "1000", credit: 10 }] }, actor);
    ds.accounts.find((a) => a.code === "7000")!.isActive = false;
    expect(() => ledger.postEntry(e.id, actor)).toThrow(TauError);
  });

  it("voids drafts but never posted entries, and exposes no delete method", () => {
    const { ledger, ds } = makeLedger();
    const draft = ledger.createEntry({ date: "2026-03-05", description: "draft", source: "MANUAL", lines: [{ accountCode: "1000", debit: 10 }, { accountCode: "4000", credit: 10 }] }, actor);
    const posted = ledger.createEntry({ date: "2026-03-05", description: "posted", source: "MANUAL", lines: [{ accountCode: "1000", debit: 10 }, { accountCode: "4000", credit: 10 }], post: true }, actor);
    expect(ledger.voidDraft(draft.id, actor).status).toBe("VOID");
    expect(() => ledger.voidDraft(posted.id, actor)).toThrow(ControlViolationError);
    expect(() => ledger.postEntry(draft.id, actor)).toThrow(ControlViolationError);
    const names = Object.getOwnPropertyNames(Ledger.prototype);
    expect(names.some((n) => /delete|remove/i.test(n))).toBe(false);
    expect(ds.journalEntries).toHaveLength(2);
    expect(ds.journalEntries.find((e) => e.id === posted.id)!.status).toBe("POSTED");
  });

  it("produces a trial balance whose debits equal credits", () => {
    const { ledger } = makeLedger();
    ledger.createEntry({ date: "2026-03-01", description: "capital", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: "10000" }, { accountCode: "3000", credit: "10000" }], post: true }, actor);
    ledger.createEntry({ date: "2026-03-10", description: "rent", source: "MANUAL", lines: [{ accountCode: "7100", debit: "1500" }, { accountCode: "1000", credit: "1500" }], post: true }, actor);
    ledger.createEntry({ date: "2026-03-15", description: "sale", source: "MANUAL", lines: [{ accountCode: "1100", debit: "4200.33" }, { accountCode: "4000", credit: "4200.33" }], post: true }, actor);
    const tb = ledger.trialBalance("2026-03-31");
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebits).toBe(tb.totalCredits);
    expect(tb.totalDebits).toBe("14200.3300");
    expect(tb.rows.map((r) => r.code)).toEqual(["1000", "1100", "3000", "4000", "7100"]);
    expect(tb.rows.find((r) => r.code === "1000")!.balance).toBe("8500.0000");
    const activity = ledger.trialBalance("2026-03-31", "2026-03-10");
    expect(activity.balanced).toBe(true);
    expect(activity.rows.find((r) => r.code === "1000")!.balance).toBe("-1500.0000");
  });

  it("getPeriod throws for unknown dates and ensurePeriod creates 'YYYY-MM' periods", () => {
    const { ledger, ds } = makeLedger();
    expect(() => ledger.getPeriod("2026-05-01")).toThrow(/No period/);
    const p = ledger.ensurePeriod("2026-05-14");
    expect(p).toMatchObject({ id: "2026-05", year: 2026, month: 5, startDate: "2026-05-01", endDate: "2026-05-31", status: "OPEN" });
    expect(ledger.ensurePeriod("2026-05-02")).toBe(p);
    expect(ds.periods).toHaveLength(1);
  });
});
