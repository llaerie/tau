import { beforeAll, describe, expect, it } from "vitest";
import { pointAtTempDemoDb } from "../test/db";

pointAtTempDemoDb();

describe("preview router (no model connected)", () => {
  let viewer: import("../auth/session").Viewer;
  let previewRouter: typeof import("./preview").previewRouter;
  let toEnvelope: typeof import("./preview").toEnvelope;
  beforeAll(async () => {
    const { viewerForUserId } = await import("../auth/session");
    const { DEMO } = await import("../db/seed");
    viewer = viewerForUserId(DEMO.users.arielle.id)!;
    ({ previewRouter, toEnvelope } = await import("./preview"));
  });

  it("answers the spend question from the food plan and never invents a take-home figure", () => {
    const r = previewRouter(viewer, "What can I spend this month?", "me");
    expect(r.calls.map((c) => c.name)).toContain("get_personal_food_plan");
    expect(r.text).toMatch(/before income tax/);
    expect(r.text).not.toMatch(/\$2,7\d\d per payroll/);
    const env = toEnvelope(viewer, r.calls, r.text, r.summary, "preview", "me", r.nextAction);
    expect(env.mode).toBe("preview");
    expect(env.nextAction?.kind).toBe("set_food_target");
  });

  it("asks for details for the receipt and purchase starters instead of guessing", () => {
    const rec = previewRouter(viewer, "Record a receipt", "me");
    expect(rec.calls).toHaveLength(0);
    expect(rec.nextAction?.href).toBe("/documents");
    expect(toEnvelope(viewer, rec.calls, rec.text, rec.summary, "preview", "me", rec.nextAction).answerType).toBe("preview");
    const plan = previewRouter(viewer, "Plan a purchase", "company");
    expect(plan.calls).toHaveLength(0);
    expect(plan.text).toMatch(/nothing is paid/i);
  });

  it("drafts a receipt with a split as an approval-gated action", () => {
    const r = previewRouter(viewer, "Record a $42.50 dinner receipt, split with Will", "me");
    const draft = r.calls.find((c) => c.name === "draft_expense");
    expect(draft?.draft?.status).toBe("draft");
    expect(draft?.draft?.preview.rows.some((row) => row.after.includes("$21.25"))).toBe(true);
    const env = toEnvelope(viewer, r.calls, r.text, r.summary, "preview", "me");
    expect(env.actionDrafts).toHaveLength(1);
    expect(env.answerType).toBe("draft");
  });

  it("questions about the partner's purchases go to the coarse summary only", () => {
    const r = previewRouter(viewer, "What did Will buy this month?", "me");
    expect(r.calls.map((c) => c.name)).toEqual(["get_partner_summary"]);
    expect(r.text).toMatch(/Individual purchases are private/);
  });

  it("company questions use the partial remainder with its exact label", () => {
    const r = previewRouter(viewer, "How is the company doing on cash?", "company");
    expect(r.calls[0].name).toBe("get_money_summary");
    expect(r.text).toMatch(/partial remainder/);
    expect(r.text).toMatch(/not profit, not a balance and not safe to spend/);
  });
});
