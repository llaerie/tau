/**
 * Model registry: resolves the configured provider, builds a fallback chain per role
 * (remote providers first, local deterministic provider last), enforces the secrets guard on
 * every outbound text, and records fallback events for the audit trail.
 */
import type { z } from "zod";
import type {
  ClassifyRequest,
  ClassifyResponse,
  EmbeddingProvider,
  FastClassificationModel,
  ModelRegistry,
  ModelRequest,
  ModelResponse,
  ReasoningModel,
  VerificationModel,
  VerificationRequest,
  VerificationResponse,
} from "@/lib/core/contracts";
import { TauError } from "@/lib/core/errors";
import type { ModelInfo } from "@/lib/core/types";
import { AnthropicFastModel, AnthropicReasoningModel, AnthropicVerificationModel } from "./anthropic-provider";
import {
  DEFAULT_FALLBACK_TIMEOUT_MS,
  FallbackEmbeddingProvider,
  FallbackFastModel,
  FallbackReasoningModel,
  FallbackVerificationModel,
  type FallbackEvent,
  type FallbackRecorder,
} from "./fallback";
import { assertNoSecretsInMessages, assertNoSecretsInText, assertNoSecretsInTexts } from "./guards";
import { LocalDeterministicProvider } from "./local-provider";
import { OpenAIEmbeddingProvider, OpenAIFastModel, OpenAIReasoningModel, OpenAIVerificationModel } from "./openai-provider";
import { PROMPT_VERSION } from "./prompt-versions";

export type ModelProviderName = "auto" | "anthropic" | "openai" | "local";
export type ResolvedProviderName = Exclude<ModelProviderName, "auto">;

export interface ModelChains {
  reasoning?: ReasoningModel[];
  fast?: FastClassificationModel[];
  verification?: VerificationModel[];
  embedding?: EmbeddingProvider[];
}

export interface ModelRegistryConfig {
  /** Overrides TAU_MODEL_PROVIDER. */
  provider?: ModelProviderName;
  /** Per-call timeout before falling back (default 60s). */
  fallbackTimeoutMs?: number;
  /** Explicit chains (tests / custom wiring). The local provider is always appended. */
  chains?: ModelChains;
  /** Environment to read (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Shared local provider instance (defaults to a fresh one). */
  local?: LocalDeterministicProvider;
  /** Disable the secrets guard (never in production; exists for adversarial evals). */
  disableSecretsGuard?: boolean;
}

export interface ModelRegistryDescription {
  reasoning: ModelInfo;
  fast: ModelInfo;
  verification: ModelInfo;
  embedding: ModelInfo;
  provider: string;
  promptVersion: string;
  fallbackTimeoutMs: number;
  chains: Record<"reasoning" | "fast" | "verification" | "embedding", ModelInfo[]>;
  fallbackEvents: FallbackEvent[];
}

export interface TauModelRegistry extends ModelRegistry {
  readonly provider: ResolvedProviderName;
  describe(): ModelRegistryDescription;
  getFallbackEvents(): FallbackEvent[];
  clearFallbackEvents(): void;
}

// ---------------------------------------------------------------------------
// Fallback event recording (per-registry + process-wide for audit capture)
// ---------------------------------------------------------------------------

const MAX_EVENTS = 1000;
const globalEvents: FallbackEvent[] = [];

class EventRecorder implements FallbackRecorder {
  readonly events: FallbackEvent[] = [];
  record(event: FallbackEvent): void {
    this.events.push(event);
    globalEvents.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    if (globalEvents.length > MAX_EVENTS) globalEvents.shift();
  }
}

/** Every fallback event recorded by any registry in this process (most recent last). */
export function getFallbackEvents(): FallbackEvent[] {
  return [...globalEvents];
}

export function clearFallbackEvents(): void {
  globalEvents.length = 0;
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

export function resolveProviderName(config: ModelRegistryConfig = {}): ResolvedProviderName {
  const env = config.env ?? process.env;
  const requested = (config.provider ?? env.TAU_MODEL_PROVIDER ?? "auto").trim().toLowerCase() as ModelProviderName;
  const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(env.OPENAI_API_KEY);
  switch (requested) {
    case "anthropic":
    case "openai":
    case "local":
      return requested;
    case "auto":
      return hasAnthropic ? "anthropic" : hasOpenAI ? "openai" : "local";
    default:
      throw new TauError("INVALID_MODEL_PROVIDER", `Unknown TAU_MODEL_PROVIDER "${String(requested)}" (expected auto | anthropic | openai | local)`);
  }
}

function buildDefaultChains(provider: ResolvedProviderName, env: Record<string, string | undefined>, timeoutMs: number): Required<ModelChains> {
  const chains: Required<ModelChains> = { reasoning: [], fast: [], verification: [], embedding: [] };
  const hasOpenAI = Boolean(env.OPENAI_API_KEY) || Boolean(env.OPENAI_BASE_URL);
  const addOpenAI = () => {
    chains.reasoning.push(new OpenAIReasoningModel({ env, timeoutMs }));
    chains.fast.push(new OpenAIFastModel({ env, timeoutMs }));
    chains.verification.push(new OpenAIVerificationModel({ env, timeoutMs }));
    chains.embedding.push(new OpenAIEmbeddingProvider({ env, timeoutMs }));
  };
  if (provider === "anthropic") {
    chains.reasoning.push(new AnthropicReasoningModel({ env, timeoutMs }));
    chains.fast.push(new AnthropicFastModel({ env, timeoutMs }));
    chains.verification.push(new AnthropicVerificationModel({ env, timeoutMs }));
    // Anthropic has no embeddings: OpenAI (when configured) then local.
    if (hasOpenAI) addOpenAI();
  } else if (provider === "openai") {
    addOpenAI();
  }
  return chains;
}

// ---------------------------------------------------------------------------
// Guarded wrappers (secrets never leave the process)
// ---------------------------------------------------------------------------

class GuardedReasoning implements ReasoningModel {
  constructor(private readonly inner: ReasoningModel) {}
  get info(): ModelInfo {
    return this.inner.info;
  }
  async complete(req: ModelRequest): Promise<ModelResponse> {
    assertNoSecretsInMessages(req.messages);
    return this.inner.complete(req);
  }
}

class GuardedFast implements FastClassificationModel {
  constructor(private readonly inner: FastClassificationModel) {}
  get info(): ModelInfo {
    return this.inner.info;
  }
  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    assertNoSecretsInText(req.text, "classify.text");
    return this.inner.classify(req);
  }
  async extract<T>(text: string, schema: z.ZodType<T>, instructions?: string): Promise<{ data: T | null; confidence: number; model: ModelInfo }> {
    assertNoSecretsInText(text, "extract.text");
    if (instructions) assertNoSecretsInText(instructions, "extract.instructions");
    return this.inner.extract(text, schema, instructions);
  }
}

class GuardedVerification implements VerificationModel {
  constructor(private readonly inner: VerificationModel) {}
  get info(): ModelInfo {
    return this.inner.info;
  }
  async verify(req: VerificationRequest): Promise<VerificationResponse> {
    assertNoSecretsInText(req.claim, "verify.claim");
    assertNoSecretsInTexts(
      req.evidence.map((e) => e.content),
      "verify.evidence",
    );
    return this.inner.verify(req);
  }
}

class GuardedEmbedding implements EmbeddingProvider {
  constructor(private readonly inner: EmbeddingProvider) {}
  get info(): ModelInfo {
    return this.inner.info;
  }
  get dimensions(): number {
    return this.inner.dimensions;
  }
  async embed(texts: string[]): Promise<number[][]> {
    assertNoSecretsInTexts(texts, "embed.texts");
    return this.inner.embed(texts);
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function createModelRegistry(config: ModelRegistryConfig = {}): TauModelRegistry {
  const env = config.env ?? process.env;
  const provider = resolveProviderName(config);
  const timeoutMs = config.fallbackTimeoutMs ?? Number(env.TAU_MODEL_TIMEOUT_MS ?? DEFAULT_FALLBACK_TIMEOUT_MS);
  const local = config.local ?? new LocalDeterministicProvider();
  const recorder = new EventRecorder();

  const defaults = config.chains ? { reasoning: [], fast: [], verification: [], embedding: [] } : buildDefaultChains(provider, env, timeoutMs);
  const chain = <M extends { info: ModelInfo }>(explicit: M[] | undefined, built: M[], last: M): M[] => {
    const list = [...(explicit ?? built)];
    if (!list.includes(last)) list.push(last);
    return list;
  };

  const opts = { timeoutMs, recorder };
  const reasoningChain = new FallbackReasoningModel(chain(config.chains?.reasoning, defaults.reasoning, local), opts);
  const fastChain = new FallbackFastModel(chain(config.chains?.fast, defaults.fast, local), opts);
  const verificationChain = new FallbackVerificationModel(chain(config.chains?.verification, defaults.verification, local), opts);
  const embeddingChain = new FallbackEmbeddingProvider(chain(config.chains?.embedding, defaults.embedding, local), opts);

  const guard = !config.disableSecretsGuard;
  const reasoning: ReasoningModel = guard ? new GuardedReasoning(reasoningChain) : reasoningChain;
  const fast: FastClassificationModel = guard ? new GuardedFast(fastChain) : fastChain;
  const verification: VerificationModel = guard ? new GuardedVerification(verificationChain) : verificationChain;
  const embedding: EmbeddingProvider = guard ? new GuardedEmbedding(embeddingChain) : embeddingChain;

  const infos = (models: readonly { info: ModelInfo }[]) => models.map((m) => m.info);

  return {
    provider,
    reasoning,
    fast,
    verification,
    embedding,
    describe(): ModelRegistryDescription {
      return {
        reasoning: reasoning.info,
        fast: fast.info,
        verification: verification.info,
        embedding: embedding.info,
        provider,
        promptVersion: PROMPT_VERSION,
        fallbackTimeoutMs: timeoutMs,
        chains: {
          reasoning: infos(reasoningChain.chain),
          fast: infos(fastChain.chain),
          verification: infos(verificationChain.chain),
          embedding: infos(embeddingChain.chain),
        },
        fallbackEvents: [...recorder.events],
      };
    },
    getFallbackEvents: () => [...recorder.events],
    clearFallbackEvents: () => {
      recorder.events.length = 0;
    },
  };
}

/** Convenience: a registry that is guaranteed offline (local provider only). */
export function createLocalModelRegistry(config: Omit<ModelRegistryConfig, "provider"> = {}): TauModelRegistry {
  return createModelRegistry({ ...config, provider: "local" });
}
