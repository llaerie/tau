import { describe, expect, it } from "vitest";
import { detectMapping, hashRow, mapRows, normalizeDate, parseCsv, parseSignedCents } from "./csv";

describe("csv import", () => {
  it("parses a signed-amount export", () => {
    const table = parseCsv(`Date,Description,Amount\n2026-09-03,"Coffee, Inc.",-4.50\n09/05/2026,Payroll,"2,250.00"\n`);
    const mapping = detectMapping(table.headers);
    expect(mapping).toMatchObject({ date: 0, description: 1, amount: 2 });
    const rows = mapRows(table, mapping);
    expect(rows[0]).toMatchObject({ date: "2026-09-03", description: "Coffee, Inc.", amountCents: -450 });
    expect(rows[1]).toMatchObject({ date: "2026-09-05", amountCents: 225000 });
    expect(rows[0].error).toBeUndefined();
  });

  it("parses debit / credit column exports", () => {
    const table = parseCsv(`Posting Date,Payee,Debit,Credit\n2026-09-01,Rent,1200.00,\n2026-09-02,Refund,,25.00\n`);
    const mapping = detectMapping(table.headers);
    expect(mapping.amount).toBeNull();
    const rows = mapRows(table, mapping);
    expect(rows[0].amountCents).toBe(-120000);
    expect(rows[1].amountCents).toBe(2500);
  });

  it("flags bad rows instead of dropping them silently", () => {
    const table = parseCsv(`Date,Description,Amount\nnot-a-date,Thing,1\n2026-09-01,,abc\n`);
    const rows = mapRows(table, detectMapping(table.headers));
    expect(rows[0].error).toMatch(/date/);
    expect(rows[1].error).toMatch(/amount/);
    expect(rows[1].error).toMatch(/description/);
  });

  it("handles parenthesised negatives and unicode minus", () => {
    expect(parseSignedCents("(12.34)")).toBe(-1234);
    expect(parseSignedCents("−7")).toBe(-700);
    expect(parseSignedCents("$1,000")).toBe(100000);
    expect(parseSignedCents("")).toBeNull();
  });

  it("normalizes dates", () => {
    expect(normalizeDate("2026-9-3")).toBe("2026-09-03");
    expect(normalizeDate("9/3/26")).toBe("2026-09-03");
    expect(normalizeDate("garbage")).toBeNull();
  });

  it("produces stable de-duplication hashes", () => {
    expect(hashRow("2026-09-03", -450, "Coffee")).toBe(hashRow("2026-09-03", -450, "  coffee "));
    expect(hashRow("2026-09-03", -450, "Coffee")).not.toBe(hashRow("2026-09-04", -450, "Coffee"));
  });
});
