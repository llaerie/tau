import { beforeAll, describe, expect, it } from "vitest";
import { pointAtTempDemoDb } from "../test/db";

pointAtTempDemoDb();

const load = async () => {
  const { viewerForUserId } = await import("../auth/session");
  const engine = await import("./index");
  const { DEMO } = await import("../db/seed");
  const { getDb } = await import("../db");
  return { viewerForUserId, engine, DEMO, getDb };
};

describe("action engine", () => {
  let ctx: Awaited<ReturnType<typeof load>>;
  beforeAll(async () => {
    ctx = await load();
  });

  it("drafts, approves with the quoted version and applies exactly once", async () => {
    const { viewerForUserId, engine, DEMO, getDb } = ctx;
    const arielle = viewerForUserId(DEMO.users.arielle.id)!;
    const draft = engine.draftAction(arielle, "budget_change", { personId: DEMO.persons.arielle, field: "foodTarget", amountCents: 80000 }, "test-food-1");
    expect(draft.status).toBe("draft");
    expect(draft.preview.rows.some((r) => r.after.includes("$800"))).toBe(true);
    // Same idempotency key returns the same draft rather than a second one.
    const again = engine.draftAction(arielle, "budget_change", { personId: DEMO.persons.arielle, field: "foodTarget", amountCents: 80000 }, "test-food-1");
    expect(again.id).toBe(draft.id);
    expect(() => engine.approveAction(arielle, draft.id, draft.version + 5)).toThrow();
    const approved = engine.approveAction(arielle, draft.id, draft.version);
    expect(approved.status).toBe("approved");
    const applied = engine.applyAction(arielle, draft.id);
    expect(applied.status).toBe("applied");
    const twice = engine.applyAction(arielle, draft.id);
    expect(twice.status).toBe("applied");
    expect(twice.appliedAt).toBe(applied.appliedAt);
    const fresh = viewerForUserId(DEMO.users.arielle.id)!;
    expect(fresh.assumptions.owners[DEMO.persons.arielle].foodTargetCents).toBe(80000);
    const audit = getDb().select().from((await import("../db/schema")).auditLog).all().filter((a) => a.actionId === draft.id);
    expect(audit.length).toBe(1);
  });

  it("refuses to change the partner's private plan", async () => {
    const { viewerForUserId, engine, DEMO } = ctx;
    const will = viewerForUserId(DEMO.users.will.id)!;
    expect(() => engine.draftAction(will, "budget_change", { personId: DEMO.persons.arielle, field: "foodTarget", amountCents: 50000 })).toThrow(/someone else|own/i);
  });

  it("records a split expense once, with shares that add up, and voids it without deleting", async () => {
    const { viewerForUserId, engine, DEMO, getDb } = ctx;
    const s = await import("../db/schema");
    const will = viewerForUserId(DEMO.users.will.id)!;
    const draft = engine.draftAction(will, "expense", { spaceId: DEMO.spaces.household, accountId: DEMO.accounts.hhChecking, date: "2026-09-10", amountCents: 9801, description: "Dinner test", purpose: "personal", beneficiary: "split", shares: [{ personId: DEMO.persons.will, cents: 4901 }, { personId: DEMO.persons.arielle, cents: 4900 }] }, "test-expense-1");
    const applied = engine.applyAction(will, engine.approveAction(will, draft.id, draft.version).id);
    expect(applied.status).toBe("applied");
    const txnId = (applied.result as { transactionId: string }).transactionId;
    engine.applyAction(will, draft.id);
    const rows = getDb().select().from(s.transactions).all().filter((t) => t.description === "Dinner test");
    expect(rows.length).toBe(1);
    const shares = getDb().select().from(s.expenseShares).all().filter((x) => x.transactionId === txnId);
    expect(shares.reduce((a, x) => a + x.cents, 0)).toBe(9801);
    const v = engine.draftAction(will, "void_transaction", { transactionId: txnId, reason: "test void" }, "test-void-1");
    const voided = engine.applyAction(will, engine.approveAction(will, v.id, v.version).id);
    expect(voided.status).toBe("applied");
    const row = getDb().select().from(s.transactions).all().find((t) => t.id === txnId)!;
    expect(row.voidedAt).not.toBeNull();
    expect(row.voidReason).toBe("test void");
  });

  it("cancelled drafts cannot be applied", async () => {
    const { viewerForUserId, engine, DEMO } = ctx;
    const will = viewerForUserId(DEMO.users.will.id)!;
    const d = engine.draftAction(will, "purchase_plan", { name: "Test chair", category: "furniture", unitPriceCents: 40000, quantity: 1, targetMonth: "2026-11", payerSpaceId: DEMO.spaces.company, beneficiary: "household", purpose: "personal" }, "test-plan-1");
    expect(d.preview.warnings.some((w) => /not deductible/i.test(w))).toBe(true);
    expect(engine.cancelAction(will, d.id).status).toBe("cancelled");
    expect(() => engine.applyAction(will, d.id)).toThrow();
  });
});
