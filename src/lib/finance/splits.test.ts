import { describe, expect, it } from "vitest";
import { settlements, splitByCents, splitEqual } from "./splits";

describe("expense splits", () => {
  it("splits a $120 dinner into two $60 shares and one settlement, never $240", () => {
    const shares = splitEqual(12000, ["will", "arielle"]);
    expect(shares).toEqual([
      { personId: "will", cents: 6000 },
      { personId: "arielle", cents: 6000 },
    ]);
    expect(shares.reduce((a, s) => a + s.cents, 0)).toBe(12000);
    expect(settlements("will", shares)).toEqual([{ fromPersonId: "arielle", toPersonId: "will", cents: 6000 }]);
  });

  it("keeps every cent when the amount does not divide evenly", () => {
    const shares = splitEqual(1001, ["a", "b", "c"]);
    expect(shares.map((s) => s.cents)).toEqual([334, 334, 333]);
  });

  it("rejects custom shares that do not reconcile", () => {
    expect(() => splitByCents(1000, [{ personId: "a", cents: 600 }, { personId: "b", cents: 300 }])).toThrow(/do not sum/);
  });
});
