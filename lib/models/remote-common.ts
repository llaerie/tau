/**
 * Helpers shared by the remote (Anthropic / OpenAI) providers. Nothing here logs or embeds
 * message contents in errors.
 */
import { z } from "zod";
import type { ClassifyRequest, ClassifyResponse, ModelMessage, VerificationRequest, VerificationResponse } from "@/lib/core/contracts";
import { TauError } from "@/lib/core/errors";
import type { ModelInfo } from "@/lib/core/types";
import { renderPrompt } from "./prompt-versions";

export class ModelProviderError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("MODEL_PROVIDER_ERROR", message, details);
    this.name = "ModelProviderError";
  }
}

export class ModelNotSupportedError extends TauError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("MODEL_NOT_SUPPORTED", message, details);
    this.name = "ModelNotSupportedError";
  }
}

/** Sanitised description of an unknown thrown value (never includes prompt text). */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return `${err.name}${typeof status === "number" ? ` (${status})` : ""}: ${err.message.slice(0, 200)}`;
  }
  return String(err).slice(0, 200);
}

/** Split messages into a single system string plus the user/assistant turns. */
export function splitSystem(messages: ModelMessage[]): { system: string | undefined; turns: ModelMessage[] } {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const turns = messages.filter((m) => m.role !== "system");
  return { system: systemParts.length ? systemParts.join("\n\n") : undefined, turns };
}

// ---- classify ------------------------------------------------------------

export const CLASSIFY_OUTPUT_SCHEMA = z.object({
  label: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export function classifyJsonSchema(labels: ClassifyRequest["labels"]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      label: { anyOf: [{ type: "string", enum: labels.map((l) => l.key) }, { type: "null" }] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
    },
    required: ["label", "confidence", "reason"],
    additionalProperties: false,
  };
}

export function classifyMessages(req: ClassifyRequest): ModelMessage[] {
  const labels = req.labels.map((l) => `- ${l.key}${l.description ? `: ${l.description}` : ""}`).join("\n");
  const context = req.context ? `\n\nContext:\n${JSON.stringify(req.context)}` : "";
  return [
    { role: "system", content: renderPrompt("classify.system") },
    { role: "user", content: renderPrompt("classify.user", { labels, text: req.text }) + context },
  ];
}

export function toClassifyResponse(json: unknown, labels: ClassifyRequest["labels"], model: ModelInfo): ClassifyResponse {
  const parsed = CLASSIFY_OUTPUT_SCHEMA.safeParse(json);
  if (!parsed.success) return { label: null, confidence: 0, reason: "Model returned an unparseable classification.", model };
  const allowed = new Set(labels.map((l) => l.key));
  const label = parsed.data.label !== null && allowed.has(parsed.data.label) ? parsed.data.label : null;
  return { label, confidence: label ? parsed.data.confidence : 0, reason: parsed.data.reason, model };
}

// ---- verify --------------------------------------------------------------

export const VERIFY_OUTPUT_SCHEMA = z.object({
  verdict: z.enum(["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE"]),
  issues: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const VERIFY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["SUPPORTED", "UNSUPPORTED", "CONTRADICTED", "INSUFFICIENT_EVIDENCE"] },
    issues: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["verdict", "issues", "confidence"],
  additionalProperties: false,
};

export function verifyMessages(req: VerificationRequest): ModelMessage[] {
  const evidence = req.evidence.length ? req.evidence.map((e) => `[${e.label}]\n${e.content}`).join("\n\n") : "(none)";
  const numbers = req.numbersToCheck?.length
    ? req.numbersToCheck.map((n) => `- ${n.label}: claimed ${n.claimed} | computed ${n.computed}`).join("\n")
    : "(none)";
  return [
    { role: "system", content: renderPrompt("verify.system") },
    { role: "user", content: renderPrompt("verify.user", { claim: req.claim, evidence, numbers }) },
  ];
}

export function toVerificationResponse(json: unknown, model: ModelInfo): VerificationResponse {
  const parsed = VERIFY_OUTPUT_SCHEMA.safeParse(json);
  if (!parsed.success) {
    return { verdict: "INSUFFICIENT_EVIDENCE", issues: ["Model returned an unparseable verification result."], confidence: 0, model };
  }
  return { ...parsed.data, model };
}

// ---- extract -------------------------------------------------------------

export function extractMessages(text: string, instructions: string | undefined): ModelMessage[] {
  return [
    { role: "system", content: renderPrompt("extract.system", { instructions: instructions ?? "" }) },
    { role: "user", content: text },
  ];
}
