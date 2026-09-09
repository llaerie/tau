/**
 * Fallback decorators. Each wraps an ordered chain of models: the first is tried, and on a
 * thrown error, a timeout, or a refusal the next one is tried, ending with the local
 * deterministic provider (which never fails). Every hop is recorded as a `FallbackEvent` so the
 * audit trail can capture which model actually served a request.
 */
import type { z } from "zod";
import type {
  ClassifyRequest,
  ClassifyResponse,
  EmbeddingProvider,
  FastClassificationModel,
  ModelRequest,
  ModelResponse,
  ReasoningModel,
  VerificationModel,
  VerificationRequest,
  VerificationResponse,
} from "@/lib/core/contracts";
import { TauError } from "@/lib/core/errors";
import type { ISODateTime, ModelInfo } from "@/lib/core/types";
import { describeError } from "./remote-common";

export type ModelRole = "reasoning" | "fast" | "verification" | "embedding";
export type FallbackReason = "error" | "timeout" | "refusal";

export interface FallbackEvent {
  at: ISODateTime;
  role: ModelRole;
  operation: "complete" | "classify" | "extract" | "verify" | "embed";
  from: ModelInfo;
  to: ModelInfo | null;
  reason: FallbackReason;
  /** Sanitised description; never contains prompt or response text. */
  detail: string;
  elapsedMs: number;
}

export interface FallbackRecorder {
  record(event: FallbackEvent): void;
}

export class ModelTimeoutError extends TauError {
  constructor(model: ModelInfo, timeoutMs: number) {
    super("MODEL_TIMEOUT", `${model.provider}/${model.model} did not respond within ${timeoutMs}ms`, { model, timeoutMs });
    this.name = "ModelTimeoutError";
  }
}

export class ModelRefusalError extends TauError {
  constructor(model: ModelInfo) {
    super("MODEL_REFUSAL", `${model.provider}/${model.model} refused the request`, { model });
    this.name = "ModelRefusalError";
  }
}

export class AllModelsFailedError extends TauError {
  constructor(role: ModelRole, attempts: number, last: string) {
    super("ALL_MODELS_FAILED", `All ${attempts} ${role} model(s) failed; last error: ${last}`, { role, attempts });
    this.name = "AllModelsFailedError";
  }
}

export interface FallbackOptions {
  timeoutMs?: number;
  recorder?: FallbackRecorder;
}

export const DEFAULT_FALLBACK_TIMEOUT_MS = 60_000;

/** Reject after `timeoutMs` unless the promise settles first; the timer never keeps the process alive. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

abstract class FallbackBase<M extends { readonly info: ModelInfo }> {
  readonly info: ModelInfo;
  readonly chain: readonly M[];
  protected readonly timeoutMs: number;
  private readonly recorder: FallbackRecorder | undefined;

  constructor(protected readonly role: ModelRole, chain: M[], opts: FallbackOptions = {}) {
    if (!chain.length) throw new TauError("EMPTY_MODEL_CHAIN", `Fallback chain for ${role} must contain at least one model`);
    this.chain = chain;
    this.info = chain[0].info;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS;
    this.recorder = opts.recorder;
  }

  /** Try each model in order; `isRefusal` lets callers treat a successful-but-refused response as a failure. */
  protected async attempt<R>(operation: FallbackEvent["operation"], invoke: (model: M) => Promise<R>, isRefusal?: (result: R) => boolean): Promise<R> {
    let lastDetail = "no attempts";
    for (let i = 0; i < this.chain.length; i++) {
      const model = this.chain[i];
      const next = this.chain[i + 1];
      const started = Date.now();
      let reason: FallbackReason;
      try {
        const result = await withTimeout(invoke(model), this.timeoutMs, () => new ModelTimeoutError(model.info, this.timeoutMs));
        if (isRefusal?.(result)) {
          reason = "refusal";
          lastDetail = new ModelRefusalError(model.info).message;
          if (!next) return result; // Last in chain: surface the refusal rather than fail.
        } else {
          return result;
        }
      } catch (err) {
        reason = err instanceof ModelTimeoutError ? "timeout" : "error";
        lastDetail = describeError(err);
      }
      this.recorder?.record({
        at: new Date().toISOString(),
        role: this.role,
        operation,
        from: model.info,
        to: next?.info ?? null,
        reason,
        detail: lastDetail,
        elapsedMs: Date.now() - started,
      });
    }
    throw new AllModelsFailedError(this.role, this.chain.length, lastDetail);
  }
}

export class FallbackReasoningModel extends FallbackBase<ReasoningModel> implements ReasoningModel {
  constructor(chain: ReasoningModel[], opts?: FallbackOptions) {
    super("reasoning", chain, opts);
  }
  complete(req: ModelRequest): Promise<ModelResponse> {
    return this.attempt("complete", (m) => m.complete(req), (r) => r.stopReason === "refusal" || r.stopReason === "error");
  }
}

export class FallbackFastModel extends FallbackBase<FastClassificationModel> implements FastClassificationModel {
  constructor(chain: FastClassificationModel[], opts?: FallbackOptions) {
    super("fast", chain, opts);
  }
  classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    return this.attempt("classify", (m) => m.classify(req));
  }
  extract<T>(text: string, schema: z.ZodType<T>, instructions?: string): Promise<{ data: T | null; confidence: number; model: ModelInfo }> {
    return this.attempt("extract", (m) => m.extract(text, schema, instructions));
  }
}

export class FallbackVerificationModel extends FallbackBase<VerificationModel> implements VerificationModel {
  constructor(chain: VerificationModel[], opts?: FallbackOptions) {
    super("verification", chain, opts);
  }
  verify(req: VerificationRequest): Promise<VerificationResponse> {
    return this.attempt("verify", (m) => m.verify(req));
  }
}

export class FallbackEmbeddingProvider extends FallbackBase<EmbeddingProvider> implements EmbeddingProvider {
  readonly dimensions: number;
  constructor(chain: EmbeddingProvider[], opts?: FallbackOptions) {
    super("embedding", chain, opts);
    this.dimensions = chain[0].dimensions;
  }
  embed(texts: string[]): Promise<number[][]> {
    return this.attempt("embed", (m) => m.embed(texts));
  }
}
