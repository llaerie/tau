import { describe, expect, it } from "vitest";
import type { ClassifyRequest, ClassifyResponse, FastClassificationModel, ModelRequest, ModelResponse, ReasoningModel } from "@/lib/core/contracts";
import type { ModelInfo } from "@/lib/core/types";
import { clearFallbackEvents, createModelRegistry, getFallbackEvents, resolveProviderName } from "@/lib/models/registry";
import { SecretInPromptError } from "@/lib/models/guards";
import { AllModelsFailedError } from "@/lib/models/fallback";
import { z } from "zod";

const FAKE_INFO: ModelInfo = { provider: "fake", model: "fake-primary", deterministic: false };

function fakeReasoning(behaviour: (req: ModelRequest) => Promise<ModelResponse>): ReasoningModel & { calls: number } {
  const model = {
    info: FAKE_INFO,
    calls: 0,
    async complete(req: ModelRequest) {
      model.calls++;
      return behaviour(req);
    },
  };
  return model;
}

const emptyEnv = {};

describe("provider resolution", () => {
  it("resolves to local when no keys are set", () => {
    expect(resolveProviderName({ env: emptyEnv })).toBe("local");
    const registry = createModelRegistry({ env: emptyEnv });
    expect(registry.provider).toBe("local");
    const d = registry.describe();
    expect(d.provider).toBe("local");
    expect(d.reasoning.provider).toBe("local");
    expect(d.embedding.deterministic).toBe(true);
    expect(d.promptVersion).toBe("2026.09-p1");
  });

  it("auto prefers anthropic, then openai", () => {
    expect(resolveProviderName({ env: { ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" } })).toBe("anthropic");
    expect(resolveProviderName({ env: { OPENAI_API_KEY: "y" } })).toBe("openai");
    expect(resolveProviderName({ env: { TAU_MODEL_PROVIDER: "local", ANTHROPIC_API_KEY: "x" } })).toBe("local");
  });

  it("rejects unknown provider names", () => {
    expect(() => resolveProviderName({ env: { TAU_MODEL_PROVIDER: "bogus" } })).toThrow(/Unknown TAU_MODEL_PROVIDER/);
  });

  it("builds provider chains ending in local without making network calls", () => {
    const d = createModelRegistry({ env: { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "o" } }).describe();
    expect(d.chains.reasoning.map((m) => m.provider)).toEqual(["anthropic", "openai", "local"]);
    expect(createModelRegistry({ env: { ANTHROPIC_API_KEY: "k" } }).describe().chains.reasoning.map((m) => m.provider)).toEqual(["anthropic", "local"]);
    expect(d.chains.embedding.map((m) => m.provider)).toEqual(["openai", "local"]);
    expect(d.reasoning.model).toBe("claude-opus-5");
    expect(d.fast.model).toBe("claude-haiku-4-5");
  });
});

describe("fallback decorator", () => {
  it("falls back to local when the primary throws and records the event", async () => {
    clearFallbackEvents();
    const primary = fakeReasoning(async () => {
      throw new Error("boom: sk-should-not-leak");
    });
    const registry = createModelRegistry({ env: emptyEnv, chains: { reasoning: [primary] } });
    const res = await registry.reasoning.complete({ messages: [{ role: "user", content: "hello" }] });
    expect(primary.calls).toBe(1);
    expect(res.model.provider).toBe("local");
    expect(res.text).toBe("LOCAL_DETERMINISTIC: hello");

    const events = registry.getFallbackEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ role: "reasoning", operation: "complete", reason: "error", from: FAKE_INFO, to: { provider: "local" } });
    expect(registry.describe().fallbackEvents).toHaveLength(1);
    expect(getFallbackEvents()).toHaveLength(1);
  });

  it("falls back when the primary returns a refusal stop reason", async () => {
    const primary = fakeReasoning(async () => ({
      text: "",
      toolCalls: [],
      model: FAKE_INFO,
      stopReason: "refusal",
      latencyMs: 1,
    }));
    const registry = createModelRegistry({ env: emptyEnv, chains: { reasoning: [primary] } });
    const res = await registry.reasoning.complete({ messages: [{ role: "user", content: "refuse me" }] });
    expect(res.model.provider).toBe("local");
    expect(res.stopReason).toBe("end");
    expect(registry.getFallbackEvents()[0]).toMatchObject({ reason: "refusal" });
  });

  it("falls back on timeout", async () => {
    const primary = fakeReasoning(() => new Promise<ModelResponse>(() => {}));
    const registry = createModelRegistry({ env: emptyEnv, chains: { reasoning: [primary] }, fallbackTimeoutMs: 20 });
    const res = await registry.reasoning.complete({ messages: [{ role: "user", content: "slow" }] });
    expect(res.model.provider).toBe("local");
    expect(registry.getFallbackEvents()[0]).toMatchObject({ reason: "timeout" });
  });

  it("does not fall back when the primary succeeds", async () => {
    const primary = fakeReasoning(async () => ({ text: "primary", toolCalls: [], model: FAKE_INFO, stopReason: "end", latencyMs: 1 }));
    const registry = createModelRegistry({ env: emptyEnv, chains: { reasoning: [primary] } });
    const res = await registry.reasoning.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(res.text).toBe("primary");
    expect(registry.getFallbackEvents()).toHaveLength(0);
    expect(registry.describe().reasoning).toEqual(FAKE_INFO);
  });

  it("wraps the fast model too", async () => {
    const primary: FastClassificationModel = {
      info: FAKE_INFO,
      async classify(_req: ClassifyRequest): Promise<ClassifyResponse> {
        throw new Error("down");
      },
      async extract() {
        throw new Error("down");
      },
    };
    const registry = createModelRegistry({ env: emptyEnv, chains: { fast: [primary] } });
    const res = await registry.fast.classify({ text: "software subscription", labels: [{ key: "software_subscriptions" }] });
    expect(res.label).toBe("software_subscriptions");
    expect(res.model.provider).toBe("local");
    const ex = await registry.fast.extract("Total: $5.00", z.object({ total: z.string() }));
    expect(ex.data).toEqual({ total: "5.00" });
    expect(registry.getFallbackEvents().map((e) => e.operation)).toEqual(["classify", "extract"]);
  });

  it("throws AllModelsFailedError when every model in an explicit chain fails", async () => {
    const primary = fakeReasoning(async () => {
      throw new Error("down");
    });
    const failingLocal = fakeReasoning(async () => {
      throw new Error("also down");
    });
    // Explicit chain without the real local provider appended is not possible via registry (local is always appended),
    // so exercise the decorator directly.
    const { FallbackReasoningModel } = await import("@/lib/models/fallback");
    const chain = new FallbackReasoningModel([primary, failingLocal], { timeoutMs: 100 });
    await expect(chain.complete({ messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(AllModelsFailedError);
  });
});

describe("secrets guard", () => {
  const registry = createModelRegistry({ env: emptyEnv });

  it("throws before any model is invoked when a message contains an API key", async () => {
    const primary = fakeReasoning(async () => ({ text: "x", toolCalls: [], model: FAKE_INFO, stopReason: "end", latencyMs: 1 }));
    const guarded = createModelRegistry({ env: emptyEnv, chains: { reasoning: [primary] } });
    await expect(guarded.reasoning.complete({ messages: [{ role: "user", content: "use key sk-ant-api03-abcdef123456" }] })).rejects.toBeInstanceOf(SecretInPromptError);
    await expect(guarded.reasoning.complete({ messages: [{ role: "system", content: "AKIAIOSFODNN7EXAMPLE" }, { role: "user", content: "hi" }] })).rejects.toThrow(/AKIA/);
    await expect(guarded.reasoning.complete({ messages: [{ role: "user", content: "-----BEGIN RSA PRIVATE KEY-----\nabc" }] })).rejects.toThrow(/BEGIN/);
    expect(primary.calls).toBe(0);
  });

  it("guards classify, verify and embed inputs", async () => {
    await expect(registry.fast.classify({ text: "token sk-proj-abcdef0123", labels: [{ key: "a" }] })).rejects.toBeInstanceOf(SecretInPromptError);
    await expect(registry.verification.verify({ claim: "ok", evidence: [{ label: "e", content: "AKIAABCDEFGHIJKLMNOP" }] })).rejects.toBeInstanceOf(SecretInPromptError);
    await expect(registry.embedding.embed(["-----BEGIN PRIVATE KEY-----"])).rejects.toBeInstanceOf(SecretInPromptError);
  });

  it("does not flag ordinary words containing sk-", async () => {
    const res = await registry.reasoning.complete({ messages: [{ role: "user", content: "my task-list and desk-side notes" }] });
    expect(res.stopReason).toBe("end");
  });
});
