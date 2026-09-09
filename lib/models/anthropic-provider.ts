/**
 * Anthropic (Claude) provider: ReasoningModel, FastClassificationModel, VerificationModel.
 * Embeddings are not offered by Anthropic; `AnthropicEmbeddingProvider` throws so the registry
 * can substitute another embedding provider.
 *
 * Message contents are never logged. Errors are re-thrown as `ModelProviderError` with only a
 * sanitised description so the fallback decorator can record them safely.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type {
  ClassifyRequest,
  ClassifyResponse,
  EmbeddingProvider,
  FastClassificationModel,
  ModelRequest,
  ModelResponse,
  ModelToolCall,
  ReasoningModel,
  VerificationModel,
  VerificationRequest,
  VerificationResponse,
} from "@/lib/core/contracts";
import type { ModelInfo } from "@/lib/core/types";
import {
  classifyJsonSchema,
  classifyMessages,
  describeError,
  extractMessages,
  ModelNotSupportedError,
  ModelProviderError,
  splitSystem,
  toClassifyResponse,
  toVerificationResponse,
  VERIFY_JSON_SCHEMA,
  verifyMessages,
} from "./remote-common";
import { parseJsonReply } from "./text-utils";
import { zodToJsonSchema } from "./zod-json-schema";

export const DEFAULT_ANTHROPIC_REASONING_MODEL = "claude-opus-5";
export const DEFAULT_ANTHROPIC_FAST_MODEL = "claude-haiku-4-5";

export interface AnthropicProviderOptions {
  /** Injected client (tests); defaults to `new Anthropic()` which reads ANTHROPIC_API_KEY. */
  client?: Anthropic;
  model?: string;
  maxTokens?: number;
  /** Request timeout in milliseconds passed to the SDK. */
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

/** Models that accept `thinking: { type: "adaptive" }`. Haiku 4.5 and older models do not. */
export function supportsAdaptiveThinking(model: string): boolean {
  return /claude-(opus-(4-[678]|5)|sonnet-(4-6|5)|fable|mythos)/.test(model);
}

function anthropicInfo(model: string): ModelInfo {
  return { provider: "anthropic", model, deterministic: false };
}

type MessageCreateParams = Anthropic.MessageCreateParamsNonStreaming;

abstract class AnthropicBase {
  readonly info: ModelInfo;
  protected readonly maxTokens: number;
  private readonly timeoutMs: number | undefined;
  private client: Anthropic | undefined;

  constructor(model: string, opts: AnthropicProviderOptions) {
    this.info = anthropicInfo(model);
    this.client = opts.client;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.timeoutMs = opts.timeoutMs;
  }

  protected getClient(): Anthropic {
    if (!this.client) this.client = new Anthropic();
    return this.client;
  }

  /** Core request mapping shared by every interface. */
  protected async run(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const model = this.info.model;
    const { system, turns } = splitSystem(req.messages);

    const messages: Anthropic.MessageParam[] = turns.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: "(no user message)" });

    const params: MessageCreateParams = {
      model,
      max_tokens: req.maxTokens ?? this.maxTokens,
      messages,
    };
    if (system) params.system = system;
    if (req.metadata?.userId) params.metadata = { user_id: req.metadata.userId };

    const thinking = supportsAdaptiveThinking(model);
    if (thinking) params.thinking = { type: "adaptive" };
    else if (req.temperature !== undefined) params.temperature = req.temperature;

    if (req.tools?.length) {
      params.tools = req.tools.map<Anthropic.Tool>((t) => ({
        name: t.name,
        description: t.description,
        input_schema: { ...t.inputSchema, type: "object" } as Anthropic.Tool.InputSchema,
      }));
      params.tool_choice = { type: "auto" };
    }
    if (req.jsonSchema) {
      params.output_config = { format: { type: "json_schema", schema: req.jsonSchema } };
    }

    let message: Anthropic.Message;
    try {
      message = await this.getClient().messages.create(params, this.timeoutMs ? { timeout: this.timeoutMs } : undefined);
    } catch (err) {
      throw new ModelProviderError(`Anthropic request failed: ${describeError(err)}`, { provider: "anthropic", model });
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolCalls: ModelToolCall[] = message.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ name: b.name, input: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown> }));

    const stopReason = mapStopReason(message.stop_reason);
    const json = req.jsonSchema && stopReason !== "refusal" ? parseJsonReply(text) : undefined;

    return {
      text,
      json,
      toolCalls,
      model: this.info,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      stopReason,
      latencyMs: Date.now() - started,
    };
  }
}

export function mapStopReason(reason: Anthropic.StopReason | null): ModelResponse["stopReason"] {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    case "end_turn":
    case "stop_sequence":
    case "pause_turn":
    case null:
      return "end";
    default:
      return "end";
  }
}

export class AnthropicReasoningModel extends AnthropicBase implements ReasoningModel {
  constructor(opts: AnthropicProviderOptions = {}) {
    const env = opts.env ?? process.env;
    super(opts.model ?? env.TAU_REASONING_MODEL ?? DEFAULT_ANTHROPIC_REASONING_MODEL, opts);
  }
  complete(req: ModelRequest): Promise<ModelResponse> {
    return this.run(req);
  }
}

export class AnthropicFastModel extends AnthropicBase implements FastClassificationModel {
  constructor(opts: AnthropicProviderOptions = {}) {
    const env = opts.env ?? process.env;
    super(opts.model ?? env.TAU_FAST_MODEL ?? DEFAULT_ANTHROPIC_FAST_MODEL, { maxTokens: 1024, ...opts });
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    const res = await this.run({ messages: classifyMessages(req), jsonSchema: classifyJsonSchema(req.labels), temperature: 0 });
    if (res.stopReason === "refusal") throw new ModelProviderError("Anthropic refused the classification request.", { stopReason: "refusal" });
    return toClassifyResponse(res.json, req.labels, this.info);
  }

  async extract<T>(text: string, schema: z.ZodType<T>, instructions?: string): Promise<{ data: T | null; confidence: number; model: ModelInfo }> {
    const res = await this.run({ messages: extractMessages(text, instructions), jsonSchema: zodToJsonSchema(schema), temperature: 0 });
    if (res.stopReason === "refusal") throw new ModelProviderError("Anthropic refused the extraction request.", { stopReason: "refusal" });
    const parsed = schema.safeParse(res.json);
    return parsed.success ? { data: parsed.data, confidence: 0.9, model: this.info } : { data: null, confidence: 0, model: this.info };
  }
}

export class AnthropicVerificationModel extends AnthropicBase implements VerificationModel {
  constructor(opts: AnthropicProviderOptions = {}) {
    const env = opts.env ?? process.env;
    super(opts.model ?? env.TAU_VERIFICATION_MODEL ?? env.TAU_REASONING_MODEL ?? DEFAULT_ANTHROPIC_REASONING_MODEL, opts);
  }

  async verify(req: VerificationRequest): Promise<VerificationResponse> {
    const res = await this.run({ messages: verifyMessages(req), jsonSchema: VERIFY_JSON_SCHEMA });
    if (res.stopReason === "refusal") throw new ModelProviderError("Anthropic refused the verification request.", { stopReason: "refusal" });
    return toVerificationResponse(res.json, this.info);
  }
}

/** Anthropic does not offer an embeddings endpoint; the registry must use another provider. */
export class AnthropicEmbeddingProvider implements EmbeddingProvider {
  readonly info: ModelInfo = { provider: "anthropic", model: "none", deterministic: false };
  readonly dimensions = 0;
  async embed(_texts: string[]): Promise<number[][]> {
    throw new ModelNotSupportedError("Anthropic does not provide an embeddings API; configure OpenAI or use the local embedding provider.", {
      provider: "anthropic",
    });
  }
}
