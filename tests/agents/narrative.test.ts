import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelResponse, ReasoningModel, ToolContext } from "@/lib/core/contracts";
import { checkNarrativeNumbers, collectNumbers, extractNumbersFromText } from "@/lib/agents/numeric-guard";
import { createAgents } from "@/lib/agents/registry";
import { OWNER, makeFixtureRuntime } from "./fixture";

function fakeModel(text: string): ReasoningModel {
  return {
    info: { provider: "fake", model: "fake-llm", deterministic: false },
    async complete(_req: ModelRequest): Promise<ModelResponse> {
      return { text, json: JSON.parse(text), toolCalls: [], model: this.info, stopReason: "end", latencyMs: 1 };
    },
  };
}

describe("numeric guard", () => {
  it("extracts numbers and matches within tolerance, rounding and percent forms", () => {
    const allowed = collectNumbers({ cash: "80500.0000", ratio: 0.42, months: 12 });
    expect(extractNumbersFromText("Cash is $80,500 and margin 42%").map((n) => n.value)).toContain(80500);
    expect(checkNarrativeNumbers("Cash is $80,500 (about 80.5k), margin 42%, over 12 months.", allowed).ok).toBe(true);
    const bad = checkNarrativeNumbers("Cash is $91,200 which is great.", allowed);
    expect(bad.ok).toBe(false);
    expect(bad.unsupported).toContain("$91,200");
  });

  it("rejects a model narrative with a fabricated number and keeps the deterministic text", async () => {
    const f = await makeFixtureRuntime();
    const { specialists } = createAgents();
    const ctx: ToolContext = { ...f.ctx("treasury"), models: { ...f.rt.models, reasoning: fakeModel(JSON.stringify({ answer: "You have $99,999 in cash, congratulations.", why: ["Because I said so"], recommendation: "Spend it" })) } };
    const res = await specialists.treasury.handle({ message: "cash", task: { kind: "cash.position" }, actor: OWNER }, ctx);
    expect(res.structured.narrative).toBe("narrative_rejected");
    expect(res.response.answer).not.toContain("99,999");
    expect(res.response.answer).toContain("80500.0000");
    const ev = f.ds.auditEvents.find((e) => e.id === res.auditEventId);
    expect(ev?.explanation).toMatch(/narrative_rejected/);
  });

  it("accepts a model narrative whose numbers are all supported", async () => {
    const f = await makeFixtureRuntime();
    const { specialists } = createAgents();
    const ctx: ToolContext = { ...f.ctx("treasury"), models: { ...f.rt.models, reasoning: fakeModel(JSON.stringify({ answer: "Cash on hand is $80,500 across 2 accounts.", why: ["Checking holds 60,500 and savings 20,000."], recommendation: "No action needed." })) } };
    const res = await specialists.treasury.handle({ message: "cash", task: { kind: "cash.position" }, actor: OWNER }, ctx);
    expect(res.structured.narrative).toBe("rewritten");
    expect(res.response.answer).toContain("$80,500");
  });
});
