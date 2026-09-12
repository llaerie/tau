import { describe, expect, it } from "vitest";
import { extractReceipt, parseAmountCents } from "./documents";

describe("parseAmountCents", () => {
  it("reads a grouped thousands amount at full value, not a hundredth of it", () => {
    expect(parseAmountCents("1,399.00")).toBe(139900);
    expect(parseAmountCents("1,399")).toBe(139900);
    expect(parseAmountCents("12,345.67")).toBe(1234567);
  });

  it("reads a European decimal comma", () => {
    expect(parseAmountCents("12,50")).toBe(1250);
    expect(parseAmountCents("1.399,00")).toBe(139900);
  });

  it("reads plain amounts", () => {
    expect(parseAmountCents("120.00")).toBe(12000);
    expect(parseAmountCents("45")).toBe(4500);
  });

  it("returns null rather than a number it had to guess at", () => {
    expect(parseAmountCents("")).toBeNull();
    expect(parseAmountCents("abc")).toBeNull();
    expect(parseAmountCents("1.2.3.4")).toBe(1234 * 100);
  });
});

describe("extractReceipt", () => {
  it("takes the total from a digital receipt without losing the thousands", () => {
    const r = extractReceipt("Apple Store\nMac mini M4\nTotal $1,399.00\n2026-09-11\n");
    expect(r.amountCents).toBe(139900);
    expect(r.date).toBe("2026-09-11");
    expect(r.merchant).toBe("Apple Store");
    expect(r.confidence).toBe("text");
  });

  it("still reads a small total", () => {
    expect(extractReceipt("Nopa\nTable 4\nTotal $120.00\n2026-09-09\n").amountCents).toBe(12000);
  });

  it("reports no extraction for an empty file rather than inventing one", () => {
    expect(extractReceipt(null)).toEqual({ amountCents: null, date: null, merchant: null, confidence: "none" });
  });
});
