import { describe, expect, it } from "vitest";
import { UnbalancedEntryError } from "@/lib/core/errors";
import { add, allocate, money } from "@/lib/core/money";
import { actor, makeLedger } from "./fixture";

describe("Currency precision", () => {
  it("treats 0.1 + 0.2 as exactly 0.3 (no binary float leakage)", () => {
    const { ledger } = makeLedger();
    expect(add(0.1, 0.2)).toBe("0.3000");
    expect(0.1 + 0.2 === 0.3).toBe(false); // the JS trap the ledger must avoid
    const e = ledger.createEntry(
      {
        date: "2026-03-01",
        description: "float trap",
        source: "MANUAL",
        lines: [{ accountCode: "7000", debit: 0.1 }, { accountCode: "7010", debit: 0.2 }, { accountCode: "1000", credit: "0.3" }],
        post: true,
      },
      actor,
    );
    expect(e.lines.map((l) => l.debit)).toEqual(["0.1000", "0.2000", "0.0000"]);
    expect(ledger.trialBalance("2026-03-31").balanced).toBe(true);
  });

  it("accepts a JS-number sum like 0.1+0.2 on a single line because amounts are normalized to 4dp", () => {
    const { ledger } = makeLedger();
    const e = ledger.createEntry(
      { date: "2026-03-01", description: "normalized", source: "MANUAL", lines: [{ accountCode: "7000", debit: 0.1 + 0.2 }, { accountCode: "1000", credit: "0.3" }], post: true },
      actor,
    );
    expect(e.lines[0].debit).toBe("0.3000");
  });

  it("rejects entries that are off by a fraction of a cent beyond 4dp tolerance", () => {
    const { ledger } = makeLedger();
    expect(() =>
      ledger.createEntry({ date: "2026-03-01", description: "off", source: "MANUAL", lines: [{ accountCode: "7000", debit: "100.001" }, { accountCode: "1000", credit: "100" }] }, actor),
    ).toThrow(UnbalancedEntryError);
    expect(() =>
      ledger.createEntry({ date: "2026-03-01", description: "off", source: "MANUAL", lines: [{ accountCode: "7000", debit: "1234.5678" }, { accountCode: "1000", credit: "1234.5679" }] }, actor),
    ).toThrow(UnbalancedEntryError);
  });

  it("allocates totals with no leakage and the ledger accepts the allocated lines", () => {
    const { ledger } = makeLedger();
    const parts = allocate("100.00", [1, 1, 1]);
    expect(parts).toEqual(["33.3400", "33.3300", "33.3300"]);
    expect(add(...parts)).toBe("100.0000");
    const parts2 = allocate("999.99", [3, 5, 7, 11]);
    expect(add(...parts2)).toBe("999.9900");
    const e = ledger.createEntry(
      {
        date: "2026-03-01",
        description: "split",
        source: "MANUAL",
        lines: [...parts2.map((p, i) => ({ accountCode: ["7000", "7010", "7100", "7150"][i], debit: p })), { accountCode: "1000", credit: "999.99" }],
        post: true,
      },
      actor,
    );
    expect(e.status).toBe("POSTED");
    expect(money(ledger.accountBalance("acct_1000", "2026-03-31"))).toBe("-999.9900");
  });

  it("keeps large sums exact where floats would not", () => {
    const { ledger } = makeLedger();
    const big = "12345678901234.56";
    ledger.createEntry({ date: "2026-03-01", description: "big", source: "OPENING_BALANCE", lines: [{ accountCode: "1000", debit: big }, { accountCode: "3000", credit: big }], post: true }, actor);
    ledger.createEntry({ date: "2026-03-02", description: "tiny", source: "MANUAL", lines: [{ accountCode: "7000", debit: "0.01" }, { accountCode: "1000", credit: "0.01" }], post: true }, actor);
    expect(ledger.accountBalance("acct_1000", "2026-03-31")).toBe("12345678901234.5500");
  });
});
