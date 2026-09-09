import { describe, expect, it } from "vitest";
import { known, unknown } from "./money";
import { addMonths, project } from "./projection";

describe("projection", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("projects cash month by month with one-time and recurring events", () => {
    const p = project({
      startingCash: known(100000),
      startMonth: "2026-09",
      months: 4,
      monthlyInflows: [{ label: "income", amount: known(50000) }],
      monthlyOutflows: [{ label: "bills", amount: known(30000) }],
      events: [
        { monthOffset: 1, amountCents: -90000, label: "laptop" },
        { monthOffset: 2, amountCents: -10000, label: "subscription", repeatMonths: null },
      ],
    });
    expect(p.months.map((m) => m.endingCashCents)).toEqual([120000, 50000, 60000, 70000]);
    expect(p.minCashCents).toBe(50000);
    expect(p.firstNegativeMonth).toBeNull();
    expect(p.unknowns).toEqual([]);
  });

  it("flags the first negative month", () => {
    const p = project({
      startingCash: known(10000),
      startMonth: "2026-09",
      months: 3,
      monthlyInflows: [],
      monthlyOutflows: [{ label: "rent", amount: known(8000) }],
    });
    expect(p.firstNegativeMonth).toBe("2026-10");
  });

  it("keeps ending cash null when starting cash is unknown", () => {
    const p = project({
      startingCash: unknown("balance not entered"),
      startMonth: "2026-09",
      months: 2,
      monthlyInflows: [{ label: "x", amount: unknown("tax") }],
      monthlyOutflows: [],
    });
    expect(p.months[0].endingCashCents).toBeNull();
    expect(p.unknowns).toEqual(["tax", "balance not entered"]);
  });
});
