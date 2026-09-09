import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { z } from "zod";
import { AnthropicEmbeddingProvider, AnthropicFastModel, AnthropicReasoningModel, mapStopReason, supportsAdaptiveThinking } from "@/lib/models/anthropic-provider";
import { OpenAIEmbeddingProvider, OpenAIReasoningModel, OpenAIVerificationModel, mapFinishReason } from "@/lib/models/openai-provider";
import { ModelNotSupportedError, ModelProviderError } from "@/lib/models/remote-common";
import { zodToJsonSchema } from "@/lib/models/zod-json-schema";
import { PROMPT_TEMPLATES, PROMPT_VERSION, promptVersionTag, renderPrompt } from "@/lib/models/prompt-versions";

function fakeAnthropic(reply: Partial<Anthropic.Message>, capture: { params?: Anthropic.MessageCreateParams } = {}): Anthropic {
  const message: Anthropic.Message = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null, server_tool_use: null, service_tier: null } as Anthropic.Usage,
    ...reply,
  };
  return {
    messages: {
      async create(params: Anthropic.MessageCreateParams) {
        capture.params = params;
        return message;
      },
    },
  } as unknown as Anthropic;
}

describe("AnthropicReasoningModel (mocked client)", () => {
  it("maps request shape: system, adaptive thinking, tools and json schema", async () => {
    const capture: { params?: Anthropic.MessageCreateParams } = {};
    const client = fakeAnthropic(
      { content: [{ type: "text", text: '{"ok":true}', citations: null }, { type: "tool_use", id: "t1", name: "lookup", input: { q: 1 }, caller: { type: "direct" } } as Anthropic.ToolUseBlock], stop_reason: "tool_use" },
      capture,
    );
    const model = new AnthropicReasoningModel({ client, env: {} });
    expect(model.info).toEqual({ provider: "anthropic", model: "claude-opus-5", deterministic: false });
    const res = await model.complete({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      tools: [{ name: "lookup", description: "d", inputSchema: { type: "object", properties: { q: { type: "number" } } } }],
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      temperature: 0.2,
    });
    const p = capture.params!;
    expect(p.system).toBe("sys");
    expect(p.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.temperature).toBeUndefined();
    expect(p.tools?.[0]).toMatchObject({ name: "lookup", input_schema: { type: "object" } });
    expect(p.tool_choice).toEqual({ type: "auto" });
    expect(p.output_config).toEqual({ format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } } } } });
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toEqual([{ name: "lookup", input: { q: 1 } }]);
    expect(res.json).toEqual({ ok: true });
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("does not send thinking for haiku and honours env model names", async () => {
    const capture: { params?: Anthropic.MessageCreateParams } = {};
    const client = fakeAnthropic({ content: [{ type: "text", text: '{"label":"a","confidence":0.9,"reason":"r"}', citations: null }] }, capture);
    const fast = new AnthropicFastModel({ client, env: { TAU_FAST_MODEL: "claude-haiku-4-5" } });
    const res = await fast.classify({ text: "x", labels: [{ key: "a" }, { key: "b" }] });
    expect(capture.params!.model).toBe("claude-haiku-4-5");
    expect(capture.params!.thinking).toBeUndefined();
    expect(capture.params!.temperature).toBe(0);
    expect(res).toEqual({ label: "a", confidence: 0.9, reason: "r", model: fast.info });
    expect(supportsAdaptiveThinking("claude-haiku-4-5")).toBe(false);
    expect(supportsAdaptiveThinking("claude-opus-5")).toBe(true);
    expect(supportsAdaptiveThinking("claude-sonnet-4-6")).toBe(true);
  });

  it("maps refusal stop reason and wraps SDK errors", async () => {
    const refusing = new AnthropicReasoningModel({ client: fakeAnthropic({ stop_reason: "refusal" }), env: {} });
    const res = await refusing.complete({ messages: [{ role: "user", content: "x" }], jsonSchema: { type: "object" } });
    expect(res.stopReason).toBe("refusal");
    expect(res.json).toBeUndefined();
    expect(mapStopReason("max_tokens")).toBe("max_tokens");
    expect(mapStopReason("end_turn")).toBe("end");

    const failing = { messages: { async create() { throw new Error("network down"); } } } as unknown as Anthropic;
    await expect(new AnthropicReasoningModel({ client: failing, env: {} }).complete({ messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(ModelProviderError);
  });

  it("has no embeddings", async () => {
    await expect(new AnthropicEmbeddingProvider().embed(["x"])).rejects.toBeInstanceOf(ModelNotSupportedError);
  });
});

function fakeOpenAI(choice: Partial<OpenAI.ChatCompletion.Choice["message"]>, finish: OpenAI.ChatCompletion.Choice["finish_reason"] = "stop", capture: { params?: OpenAI.ChatCompletionCreateParams } = {}): OpenAI {
  return {
    chat: {
      completions: {
        async create(params: OpenAI.ChatCompletionCreateParams): Promise<OpenAI.ChatCompletion> {
          capture.params = params;
          return {
            id: "c1",
            object: "chat.completion",
            created: 0,
            model: "gpt-5",
            choices: [{ index: 0, finish_reason: finish, logprobs: null, message: { role: "assistant", content: null, refusal: null, ...choice } }],
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          };
        },
      },
    },
    embeddings: {
      async create(params: OpenAI.EmbeddingCreateParams): Promise<OpenAI.CreateEmbeddingResponse> {
        const inputs = params.input as string[];
        return {
          object: "list",
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 1, total_tokens: 1 },
          data: inputs.map((_, i) => ({ object: "embedding", index: inputs.length - 1 - i, embedding: [inputs.length - 1 - i] })),
        };
      },
    },
  } as unknown as OpenAI;
}

describe("OpenAI providers (mocked client)", () => {
  it("maps tools, response_format and tool calls", async () => {
    const capture: { params?: OpenAI.ChatCompletionCreateParams } = {};
    const client = fakeOpenAI(
      { content: "", tool_calls: [{ id: "x", type: "function", function: { name: "lookup", arguments: '{"q":1}' } }] },
      "tool_calls",
      capture,
    );
    const model = new OpenAIReasoningModel({ client, env: { TAU_OPENAI_REASONING_MODEL: "gpt-test" } });
    const res = await model.complete({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      tools: [{ name: "lookup", description: "d", inputSchema: { type: "object" } }],
      jsonSchema: { type: "object" },
    });
    expect(capture.params!.model).toBe("gpt-test");
    expect(capture.params!.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(capture.params!.tools?.[0]).toMatchObject({ type: "function", function: { name: "lookup" } });
    expect(capture.params!.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "tau_response" } });
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls).toEqual([{ name: "lookup", input: { q: 1 } }]);
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it("treats refusal/content_filter as refusal", async () => {
    const refused = new OpenAIReasoningModel({ client: fakeOpenAI({ refusal: "no" }), env: {} });
    expect((await refused.complete({ messages: [{ role: "user", content: "x" }] })).stopReason).toBe("refusal");
    expect(mapFinishReason("content_filter", false)).toBe("refusal");
    expect(mapFinishReason("length", false)).toBe("max_tokens");
    const verifier = new OpenAIVerificationModel({ client: fakeOpenAI({ content: '{"verdict":"SUPPORTED","issues":[],"confidence":0.8}' }), env: {} });
    const v = await verifier.verify({ claim: "c", evidence: [{ label: "e", content: "x" }] });
    expect(v.verdict).toBe("SUPPORTED");
  });

  it("returns embeddings ordered by index", async () => {
    const emb = new OpenAIEmbeddingProvider({ client: fakeOpenAI({}), env: {} });
    expect(emb.dimensions).toBe(1536);
    expect(await emb.embed(["a", "b", "c"])).toEqual([[0], [1], [2]]);
  });
});

describe("zodToJsonSchema", () => {
  it("converts common zod shapes", () => {
    const schema = z.object({
      vendor: z.string(),
      total: z.number().optional(),
      paid: z.boolean(),
      status: z.enum(["OPEN", "PAID"]),
      tags: z.array(z.string()),
      note: z.string().nullable(),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        vendor: { type: "string" },
        total: { type: "number" },
        paid: { type: "boolean" },
        status: { type: "string", enum: ["OPEN", "PAID"] },
        tags: { type: "array", items: { type: "string" } },
        note: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["vendor", "paid", "status", "tags", "note"],
    });
  });
});

describe("prompt versions", () => {
  it("exposes a stable version and renders templates", () => {
    expect(PROMPT_VERSION).toBe("2026.09-p1");
    expect(Object.values(PROMPT_TEMPLATES).every((t) => t.version === PROMPT_VERSION)).toBe(true);
    expect(renderPrompt("classify.user", { labels: "- a", text: "hello" })).toContain("hello");
    expect(promptVersionTag("verify.system")).toBe("2026.09-p1:verify.system@2026.09-p1");
  });
});
