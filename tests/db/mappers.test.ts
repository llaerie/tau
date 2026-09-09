/**
 * Mapper unit tests — no database required.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import type * as PC from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createStore, MemoryStore } from "@/lib/db";
import {
  compact,
  dateTimeToISO,
  dateToISO,
  decimalToString,
  fromConfigFieldRow,
  fromJournalEntryRow,
  fromPayrollRunRow,
  fromTransactionRow,
  isoToDate,
  isoToDateTime,
  stringToDecimal,
  toConfigFieldRow,
  toJournalEntryRows,
  toPayrollRunRow,
  toTransactionRow,
} from "@/lib/db/mappers";
import { makeJournalEntries, makeTinyDataset } from "./fixture";

const NOW = new Date("2026-06-01T00:00:00.000Z");

describe("decimal mapping is exact", () => {
  it("Prisma.Decimal → DecimalString always has 4 dp", () => {
    expect(decimalToString(new Prisma.Decimal("0.1"))).toBe("0.1000");
    expect(decimalToString(new Prisma.Decimal("123456789012345.6789"))).toBe("123456789012345.6789");
    expect(decimalToString(new Prisma.Decimal("-0.0001"))).toBe("-0.0001");
    expect(decimalToString(new Prisma.Decimal("0"))).toBe("0.0000");
  });

  it("DecimalString → Prisma.Decimal is validated and canonical (no binary float)", () => {
    expect(stringToDecimal("1234.5678").toFixed(4)).toBe("1234.5678");
    expect(stringToDecimal("1234.56789").toFixed(4)).toBe("1234.5679");
    expect(stringToDecimal("0.1").plus(stringToDecimal("0.2")).toFixed(4)).toBe("0.3000");
    expect(stringToDecimal("99999999999999.9999").toFixed(4)).toBe("99999999999999.9999");
    expect(() => stringToDecimal("abc")).toThrow(/Invalid decimal/);
    expect(() => stringToDecimal("1e3")).toThrow(/Invalid decimal/);
    expect(() => stringToDecimal(Number.NaN)).toThrow();
  });
});

describe("date mapping", () => {
  it("ISODate ↔ DATE column is UTC midnight", () => {
    const d = isoToDate("2026-03-31");
    expect(d.getTime()).toBe(Date.UTC(2026, 2, 31));
    expect(dateToISO(d)).toBe("2026-03-31");
    expect(dateToISO(new Date("2026-12-31T00:00:00.000Z"))).toBe("2026-12-31");
    expect(() => isoToDate("31/03/2026")).toThrow(/Invalid ISO date/);
  });

  it("ISODateTime ↔ TIMESTAMPTZ round-trips at millisecond precision", () => {
    const s = "2026-01-01T12:34:56.789Z";
    expect(dateTimeToISO(isoToDateTime(s))).toBe(s);
    expect(dateTimeToISO(isoToDateTime("2026-01-01T12:34:56+02:00"))).toBe("2026-01-01T10:34:56.000Z");
    expect(() => isoToDateTime("yesterday")).toThrow(/Invalid ISO date-time/);
  });
});

describe("entity mappers", () => {
  it("journal entries round-trip through rows with exact line amounts and ordering", () => {
    for (const entry of makeJournalEntries()) {
      const { entry: entryRow, lines } = toJournalEntryRows(entry);
      expect(lines.map((l) => l.lineNo)).toEqual(entry.lines.map((_, i) => i));
      expect(lines.map((l) => (l.debit as Prisma.Decimal).toFixed(4))).toEqual(entry.lines.map((l) => l.debit));
      // Simulate what Prisma returns (lines deliberately shuffled; the mapper sorts by lineNo).
      const row = { ...entryRow, updatedAt: NOW, lines: [...lines].reverse() } as unknown as PC.JournalEntry & {
        lines: PC.JournalLine[];
      };
      expect(fromJournalEntryRow(row)).toEqual(entry);
    }
  });

  it("transactions keep split amounts, flags, meta and null category account", () => {
    const t = makeTinyDataset().transactions[1];
    const row = { ...toTransactionRow(t), createdAt: NOW, updatedAt: NOW } as unknown as PC.Transaction;
    expect(row.categoryAccountId).toBeNull();
    expect((row.amount as Prisma.Decimal).toFixed(4)).toBe("-49.9900");
    expect(fromTransactionRow(row)).toEqual(t);
  });

  it("payroll runs store totals as columns and lines as canonical JSON", () => {
    const run = makeTinyDataset().payrollRuns[0];
    const row = toPayrollRunRow(run);
    expect((row.totalNetPay as Prisma.Decimal).toFixed(4)).toBe("7425.0000");
    expect((row.lines as { gross: string }[])[0].gross).toBe("10000.0000");
    const back = fromPayrollRunRow({ ...row, createdAt: NOW, updatedAt: NOW } as unknown as PC.PayrollRun);
    expect(back).toEqual(run);
  });

  it("config fields keep null (UNKNOWN) as SQL NULL and never coerce to zero", () => {
    const [unknownField, knownField] = makeTinyDataset().configFields;
    const unknownRow = toConfigFieldRow(unknownField);
    expect(unknownRow.value).toBe(Prisma.DbNull);
    const back = fromConfigFieldRow({ ...unknownRow, value: null, createdAt: NOW, updatedAt: isoToDateTime(unknownField.updatedAt!) } as unknown as PC.ConfigField);
    expect(back.value).toBeNull();
    expect(back).toEqual(unknownField);
    const knownRow = toConfigFieldRow(knownField);
    expect(knownRow.value).toBe("Synthetic Payroll");
    expect(fromConfigFieldRow({ ...knownRow, createdAt: NOW } as unknown as PC.ConfigField)).toEqual(knownField);
  });

  it("compact strips undefined but keeps null and empty arrays", () => {
    expect(compact({ a: 1, b: undefined, c: null, d: [] })).toEqual({ a: 1, c: null, d: [] });
  });
});

describe("createStore", () => {
  it("returns a MemoryStore by default and honours a fresh fallback dataset", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tau-db-test-"));
    const snapshotPath = join(dir, "snapshot.json");
    const store = await createStore({ kind: "memory", fresh: true, fallbackDataset: makeTinyDataset(), snapshotPath });
    expect(store).toBeInstanceOf(MemoryStore);
    expect(store.kind).toBe("memory");
    await store.upsert("vendors", { ...(await store.load()).vendors[0], id: "vendor_snapshot" }); // marks the store dirty
    await store.flush();
    const restored = await createStore({ kind: "memory", snapshotPath });
    expect((await restored.load()).profile.id).toBe("co_tiny");
    await expect(createStore({ kind: "memory", fresh: true, snapshotPath })).rejects.toThrow(/fallbackDataset/);
  });

  it("refuses postgres without DATABASE_URL", async () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(createStore({ kind: "postgres" })).rejects.toThrow(/DATABASE_URL/);
    } finally {
      if (saved !== undefined) process.env.DATABASE_URL = saved;
    }
  });
});
