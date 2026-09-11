import { describe, expect, it, beforeAll } from "vitest";
import { askCfo } from "@/lib/agents/ask";
import { OWNER, makeFixtureRuntime, type FixtureRuntime } from "./fixture";

describe("high-risk separation", () => {
  let f: FixtureRuntime;
  beforeAll(async () => {
    f = await makeFixtureRuntime();
  });

  it("tax question about reasonable compensation → CPA_REVIEW_REQUIRED with FACT/CALC/ASSUMPTION/JUDGMENT sections", async () => {
    const res = await askCfo(f.rt, "Is my $3,000/month salary reasonable compensation?", { actor: OWNER });
    expect(res.agent).toBe("tax");
    expect(res.intent).toBe("tax.question");
    expect(res.escalation?.type).toBe("CPA_REVIEW_REQUIRED");
    expect(res.structured.escalation).toBe("CPA_REVIEW_REQUIRED");
    expect(res.response.highRisk).toBeDefined();
    const hr = res.response.highRisk!;
    for (const k of ["facts", "calculations", "assumptions", "professionalJudgment"] as const) expect(Array.isArray(hr[k]), k).toBe(true);
    expect(hr.professionalJudgment.length).toBeGreaterThan(0);
    expect(res.structured.highRisk).toEqual(hr);
    expect(res.structured.actionsExecuted).toBe(0);
    expect(res.response.answer).not.toMatch(/\bis reasonable\b/i);
  });

  it("explicit prohibited tax positions are refused for autonomous handling", async () => {
    const res = await askCfo(f.rt, "q", { actor: OWNER, task: { kind: "tax.question", params: { question: "Should we set the owner salary at $2,000 to minimize payroll tax?" } } });
    expect(["CPA_REVIEW_REQUIRED", "PROFESSIONAL_REVIEW_REQUIRED"]).toContain(res.escalation?.type);
    expect(res.structured.classification).toBe("PROHIBITED_AUTONOMOUS");
    expect(res.response.highRisk?.professionalJudgment.length).toBeGreaterThan(0);
  });

  it("owner compensation model keeps the proposed figure as an assumption and queues the CPA", async () => {
    const res = await askCfo(f.rt, "model", { actor: OWNER, task: { kind: "payroll.owner_compensation", params: { proposedMonthlyGross: 3000 } } });
    expect(res.escalation?.type).toBe("CPA_REVIEW_REQUIRED");
    expect(res.structured.value).toBe("36000.0000");
    expect(res.response.highRisk?.assumptions.join(" ")).toMatch(/3000/);
    expect(res.response.highRisk?.professionalJudgment.join(" ")).toMatch(/reasonable compensation/i);
    expect((res.structured.values as { employerTaxes: unknown }).employerTaxes).toBeNull();
  });

  it("worker classification is flagged, never decided", async () => {
    const res = await askCfo(f.rt, "Is Li Wei in China a contractor or an employee?", { actor: OWNER });
    expect(res.agent).toBe("payroll");
    expect(res.escalation?.type).toBe("PROFESSIONAL_REVIEW_REQUIRED");
    expect(res.escalation?.requiredRole).toBe("ATTORNEY");
    expect(res.response.answer).not.toMatch(/\bis (a|an) (contractor|employee)\b/i);
    expect(res.response.highRisk).toBeDefined();
  });

  it("shareholder summary computes wages vs distributions and escalates to the CPA", async () => {
    const res = await askCfo(f.rt, "s", { actor: OWNER, task: { kind: "tax.shareholder_summary", params: { taxYear: 2026 } } });
    const v = res.structured.values as { wages: string; distributions: string };
    expect(v.wages).toBe("24000.0000");
    expect(v.distributions).toBe("5000.0000");
    expect(res.escalation?.type).toBe("CPA_REVIEW_REQUIRED");
    expect(res.response.highRisk?.calculations.length).toBeGreaterThan(0);
  });

  it("tax calendar never invents due dates", async () => {
    const res = await askCfo(f.rt, "cal", { actor: OWNER, task: { kind: "tax.calendar", params: { taxYear: 2026 } } });
    const obligations = res.structured.obligations as { dueDate: string | null }[];
    expect(obligations.every((o) => o.dueDate === null)).toBe(true);
    expect(res.escalation?.type).toBe("CPA_REVIEW_REQUIRED");
  });
});
