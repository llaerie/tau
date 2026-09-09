/**
 * OpenAI provider (also any OpenAI-compatible server via OPENAI_BASE_URL): ReasoningModel,
 * FastClassificationModel, VerificationModel and EmbeddingProvider.
 *
 * Message contents are never logged. Errors are re-thrown as `ModelProviderError` with only a
 * sanitised description so the fallback decorator can record them safely.
 */
import OpenAI from "openai";
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
  ModelProviderError,
  splitSystem,
  toClassifyResponse,
  toVerificationResponse,
  VERIFY_JSON_SCHEMA,
  verifyMessages,
} from "./remote-common";
import { parseJsonReply } from "./text-utils";
import { zodToJsonSchema } from "./zod-json-schema";

export const DEFAULT_OPENAI_REASONING_MODEL = "gpt-5";
export const DEFAULT_OPENAI_FAST_MODEL = "gpt-5-mini";
export const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENAI_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export interface OpenAIProviderOptions {
  /** Injected client (tests); defaults to `new OpenAI()` reading OPENAI_API_KEY / OPENAI_BASE_URL. */
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  baseURL?: string;
  env?: Record<string, string | undefined>;
}

function openaiInfo(model: string): ModelInfo {
  return { provider: "openai", model, deterministic: false };
}

abstract class OpenAIBase {
  readonly info: ModelInfo;
  protected readonly maxTokens: number;
  private readonly timeoutMs: number | undefined;
  private readonly baseURL: string | undefined;
  private client: OpenAI | undefined;

  constructor(model: string, opts: OpenAIProviderOptions) {
    const env = opts.env ?? process.env;
    this.info = openaiInfo(model);
    this.client = opts.client;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.timeoutMs = opts.timeoutMs;
    this.baseURL = opts.baseURL ?? env.OPENAI_BASE_URL ?? undefined;
  }

  protected getClient(): OpenAI {
    if (!this.client) this.client = new OpenAI(this.baseURL ? { baseURL: this.baseURL } : {});
    return this.client;
  }

  protected async run(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const model = this.info.model;
    const { system, turns } = splitSystem(req.messages);

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (system) messages.push({ role: "system", content: system });
    for (const m of turns) messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      max_completion_tokens: req.maxTokens ?? this.maxTokens,
    };
    if (req.temperature !== undefined) params.temperature = req.temperature;
    if (req.tools?.length) {
      params.tools = req.tools.map<OpenAI.ChatCompletionFunctionTool>((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
      params.tool_choice = "auto";
    }
    if (req.jsonSchema) {
      params.response_format = { type: "json_schema", json_schema: { name: "tau_response", schema: req.jsonSchema, strict: false } };
    }

    let completion: OpenAI.ChatCompletion;
    try {
      completion = await this.getClient().chat.completions.create(params, this.timeoutMs ? { timeout: this.timeoutMs } : undefined);
    } catch (err) {
      throw new ModelProviderError(`OpenAI request failed: ${describeError(err)}`, { provider: "openai", model });
    }

    const choice = completion.choices[0];
    const message = choice?.message;
    const text = message?.content ?? "";
    const toolCalls: ModelToolCall[] = (message?.tool_calls ?? [])
      .filter((c): c is OpenAI.ChatCompletionMessageFunctionToolCall => c.type === "function")
      .map((c) => ({ name: c.function.name, input: parseArguments(c.function.arguments) }));

    const refused = typeof message?.refusal === "string" && message.refusal.length > 0;
    const stopReason = refused ? "refusal" : mapFinishReason(choice?.finish_reason ?? null, toolCalls.length > 0);
    const json = req.jsonSchema && stopReason !== "refusal" ? parseJsonReply(text) : undefined;

    return {
      text,
      json,
      toolCalls,
      model: this.info,
      usage: completion.usage ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens } : undefined,
      stopReason,
      latencyMs: Date.now() - started,
    };
  }
}

function parseArguments(args: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(args || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function mapFinishReason(reason: OpenAI.ChatCompletion.Choice["finish_reason"] | null, hasToolCalls: boolean): ModelResponse["stopReason"] {
  switch (reason) {
    case "tool_calls":
    case "function_call":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    case "stop":
    case null:
    default:
      return hasToolCalls ? "tool_use" : "end";
  }
}

export class OpenAIReasoningModel extends OpenAIBase implements ReasoningModel {
  constructor(opts: OpenAIProviderOptions = {}) {
    const env = opts.env ?? process.env;
    super(opts.model ?? env.TAU_OPENAI_REASONING_MODEL ?? DEFAULT_OPENAI_REASONING_MODEL, opts);
  }
  complete(req: ModelRequest): Promise<ModelResponse> {
    return this.run(req);
  }
}

export class OpenAIFastModel extends OpenAIBase implements FastClassificationModel {
  constructor(opts: OpenAIProviderOptions = {}) {
    const env = opts.env ?? process.env;
    super(opts.model ?? env.TAU_OPENAI_FAST_MODEL ?? DEFAULT_OPENAI_FAST_MODEL, { maxTokens: 1024, ...opts });
  }

  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    const res = await this.run({ messages: classifyMessages(req), jsonSchema: classifyJsonSchema(req.labels), temperature: 0 });
    if (res.stopReason === "refusal") throw new ModelProviderError("OpenAI refused the classification request.", { stopReason: "refusal" });
    return toClassifyResponse(res.json, req.labels, this.info);
  }

  async extract<T>(text: string, schema: z.ZodType<T>, instructions?: string): Promise<{ data: T | null; confidence: number; model: ModelInfo }> {
    const res = await this.run({ messages: extractMessages(text, instructions), jsonSchema: zodToJsonSchema(schema), temperature: 0 });
    if (res.stopReason === "refusal") throw new ModelProviderError("OpenAI refused the extraction request.", { stopReason: "refusal" });
    const parsed = schema.safeParse(res.json);
    return parsed.success ? { data: parsed.data, confidence: 0.9, model: this.info } : { data: null, confidence: 0, model: this.info };
  }
}

export class OpenAIVerificationModel extends OpenAIBase implements VerificationModel {
  constructor(opts: OpenAIProviderOptions = {}) {
    const env = opts.env ?? process.env;
    super(opts.model ?? env.TAU_OPENAI_VERIFICATION_MODEL ?? env.TAU_OPENAI_REASONING_MODEL ?? DEFAULT_OPENAI_REASONING_MODEL, opts);
  }

  async verify(req: VerificationRequest): Promise<VerificationResponse> {
    const res = await this.run({ messages: verifyMessages(req), jsonSchema: VERIFY_JSON_SCHEMA, temperature: 0 });
    if (res.stopReason === "refusal") throw new ModelProviderError("OpenAI refused the verification request.", { stopReason: "refusal" });
    return toVerificationResponse(res.json, this.info);
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly info: ModelInfo;
  readonly dimensions: number;
  private readonly timeoutMs: number | undefined;
  private readonly baseURL: string | undefined;
  private client: OpenAI | undefined;

  constructor(opts: OpenAIProviderOptions & { dimensions?: number } = {}) {
    const env = opts.env ?? process.env;
    const model = opts.model ?? env.TAU_OPENAI_EMBEDDING_MODEL ?? DEFAULT_OPENAI_EMBEDDING_MODEL;
    this.info = openaiInfo(model);
    this.dimensions = opts.dimensions ?? OPENAI_EMBEDDING_DIMENSIONS[model] ?? 1536;
    this.client = opts.client;
    this.timeoutMs = opts.timeoutMs;
    this.baseURL = opts.baseURL ?? env.OPENAI_BASE_URL ?? undefined;
  }

  private getClient(): OpenAI {
    if (!this.client) this.client = new OpenAI(this.baseURL ? { baseURL: this.baseURL } : {});
    return this.client;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    let res: OpenAI.CreateEmbeddingResponse;
    try {
      res = await this.getClient().embeddings.create(
        { model: this.info.model, input: texts, encoding_format: "float" },
        this.timeoutMs ? { timeout: this.timeoutMs } : undefined,
      );
    } catch (err) {
      throw new ModelProviderError(`OpenAI embeddings request failed: ${describeError(err)}`, { provider: "openai", model: this.info.model });
    }
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    if (sorted.length !== texts.length) throw new ModelProviderError("OpenAI embeddings response count did not match input count.");
    return sorted.map((d) => d.embedding);
  }
}
