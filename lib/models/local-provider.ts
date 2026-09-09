/**
 * Fully offline, deterministic implementations of every model interface. Used by tests,
 * evals and as the final fallback when no remote provider is available or a remote call
 * fails. Same input always yields the same output.
 */
import { z } from "zod";
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
import { estimateTokens, extractJsonObjects, fnv1a32, lastMessage, parseLooseNumber, tokenize } from "./text-utils";

export const LOCAL_MODEL_INFO: ModelInfo = Object.freeze({
  provider: "local",
  model: "local-deterministic",
  version: "1",
  deterministic: true,
});

export const LOCAL_EMBEDDING_DIMENSIONS = 256;

/** Absolute and relative tolerances used when comparing claimed vs computed numbers. */
export const VERIFY_ABS_TOLERANCE = 0.005;
export const VERIFY_REL_TOLERANCE = 0.001;

const ECHO_PREFIX = "LOCAL_DETERMINISTIC: ";
const ECHO_LIMIT = 200;

// ---------------------------------------------------------------------------
// JSON schema placeholder builder
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>;

/** Build the smallest object satisfying a JSON schema's required fields with placeholders. */
export function placeholderForSchema(schema: Schema, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if ("const" in schema) return schema.const;
  const anyOf = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (anyOf && anyOf.length) return placeholderForSchema(anyOf[0], depth + 1);

  const type = Array.isArray(schema.type) ? (schema.type as string[])[0] : (schema.type as string | undefined);
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "null":
      return null;
    case "object":
    default: {
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      if (type !== "object" && !schema.properties) return null;
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : Object.keys(properties);
      const out: Record<string, unknown> = {};
      for (const key of required) {
        const child = properties[key];
        out[key] = child ? placeholderForSchema(child, depth + 1) : null;
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Extraction helpers (regex-only)
// ---------------------------------------------------------------------------

const AMOUNT_RE = /(?:\$|USD\s?)?\(?-?\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?\)?|(?:\$|USD\s?)?\(?-?\d+\.\d{1,4}\)?|\$\s?\d+/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const US_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const INVOICE_RE = /\b(?:invoice|inv)\.?\s*(?:#|no\.?|number|num)?\s*[:#]?\s*([A-Z]{0,4}-?\d[\w-]*)/i;
const VENDOR_RE = /\b(?:vendor|from|supplier|payee|bill\s*from|merchant)\s*[:\-]\s*([^\n,;]+)/i;

function firstAmount(text: string): string | null {
  const matches = text.match(AMOUNT_RE);
  return matches?.length ? normalizeAmount(matches[0]) : null;
}

function labelledAmount(text: string, label: RegExp): string | null {
  const re = new RegExp(`\\b${label.source}[^\\d$(-]{0,20}(\\(?-?\\$?\\s?\\d[\\d,]*(?:\\.\\d{1,4})?\\)?)`, "i");
  const m = text.match(re);
  return m ? normalizeAmount(m[1]) : null;
}

function largestAmount(text: string): string | null {
  const matches = text.match(AMOUNT_RE) ?? [];
  let best: { raw: string; n: number } | null = null;
  for (const raw of matches) {
    const n = parseLooseNumber(raw);
    if (n === null) continue;
    if (!best || Math.abs(n) > Math.abs(best.n)) best = { raw, n };
  }
  return best ? normalizeAmount(best.raw) : null;
}

function normalizeAmount(raw: string): string | null {
  const n = parseLooseNumber(raw);
  if (n === null) return null;
  const s = raw.replace(/[^\d.]/g, "");
  const decimals = s.includes(".") ? Math.min(4, s.split(".")[1].length) : 2;
  return n.toFixed(Math.max(2, decimals));
}

function firstIsoDate(text: string, after?: RegExp): string | null {
  const start = after ? text.search(after) : 0;
  if (start === -1) return null;
  const scope = text.slice(start);
  const iso = [...scope.matchAll(ISO_DATE_RE)][0];
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = [...scope.matchAll(US_DATE_RE)][0];
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

/** Field-name driven regex extraction. Returns null when a field is unrecognized or absent. */
export function extractFieldByName(name: string, text: string): string | null {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  switch (key) {
    case "amount":
    case "amountdue":
    case "amountpaid":
      return labelledAmount(text, /amount(?:\s*due)?/) ?? firstAmount(text);
    case "total":
    case "totalamount":
    case "grandtotal":
      return labelledAmount(text, /(?:grand\s*)?total/) ?? largestAmount(text);
    case "subtotal":
      return labelledAmount(text, /sub\s*-?total/);
    case "tax":
    case "taxamount":
    case "salestax":
      return labelledAmount(text, /(?:sales\s*)?tax/);
    case "date":
    case "invoicedate":
    case "issuedate":
    case "transactiondate":
      return firstIsoDate(text, /(?:invoice\s*)?date/i) ?? firstIsoDate(text);
    case "duedate":
      return firstIsoDate(text, /due(?:\s*date)?/i);
    case "vendor":
    case "vendorname":
    case "supplier":
    case "payee":
    case "merchant":
      return text.match(VENDOR_RE)?.[1]?.trim() ?? null;
    case "invoicenumber":
    case "invoiceno":
    case "invoiceid":
    case "invoice":
      return text.match(INVOICE_RE)?.[1]?.trim() ?? null;
    case "email":
    case "contactemail":
    case "vendoremail":
      return text.match(EMAIL_RE)?.[0] ?? null;
    default:
      return null;
  }
}

type ShapeEntry = { key: string; schema: z.ZodTypeAny };

function objectShape(schema: z.ZodTypeAny): ShapeEntry[] | null {
  let s: z.ZodTypeAny = schema;
  for (let i = 0; i < 4; i++) {
    if (s instanceof z.ZodObject) {
      return Object.entries(s.shape as Record<string, z.ZodTypeAny>).map(([key, child]) => ({ key, schema: child }));
    }
    if (s instanceof z.ZodEffects) s = s.innerType();
    else if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap();
    else if (s instanceof z.ZodDefault) s = s.removeDefault();
    else return null;
  }
  return null;
}

function innermost(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  for (let i = 0; i < 4; i++) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap();
    else if (s instanceof z.ZodDefault) s = s.removeDefault();
    else if (s instanceof z.ZodEffects) s = s.innerType();
    else break;
  }
  return s;
}

function coerceForSchema(value: string, schema: z.ZodTypeAny): unknown {
  const inner = innermost(schema);
  if (inner instanceof z.ZodNumber) return parseLooseNumber(value);
  if (inner instanceof z.ZodBoolean) return /^(true|yes|1)$/i.test(value);
  return value;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class LocalDeterministicProvider implements ReasoningModel, FastClassificationModel, VerificationModel, EmbeddingProvider {
  readonly info: ModelInfo = LOCAL_MODEL_INFO;
  readonly dimensions = LOCAL_EMBEDDING_DIMENSIONS;

  // ---- ReasoningModel ----------------------------------------------------

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const started = Date.now();
    const user = lastMessage(req.messages, "user")?.content ?? "";
    const inputTokens = req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    const finish = (partial: Pick<ModelResponse, "text" | "json" | "toolCalls" | "stopReason">): ModelResponse => ({
      ...partial,
      model: this.info,
      usage: { inputTokens, outputTokens: estimateTokens(partial.text) },
      latencyMs: Date.now() - started,
    });

    if (req.tools?.length) {
      const toolCalls = this.toolCallsFromText(user, req);
      if (toolCalls.length) return finish({ text: "", toolCalls, stopReason: "tool_use" });
    }

    if (req.jsonSchema) {
      const json = placeholderForSchema(req.jsonSchema);
      return finish({ text: JSON.stringify(json), json, toolCalls: [], stopReason: "end" });
    }

    return finish({ text: ECHO_PREFIX + user.slice(0, ECHO_LIMIT), toolCalls: [], stopReason: "end" });
  }

  private toolCallsFromText(text: string, req: ModelRequest): ModelToolCall[] {
    const known = new Set((req.tools ?? []).map((t) => t.name));
    const calls: ModelToolCall[] = [];
    for (const obj of extractJsonObjects(text)) {
      const name = obj.tool;
      if (typeof name !== "string" || !known.has(name)) continue;
      const input = obj.input;
      calls.push({ name, input: input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {} });
    }
    return calls;
  }

  // ---- FastClassificationModel -------------------------------------------

  async classify(req: ClassifyRequest): Promise<ClassifyResponse> {
    const textTokens = new Set(tokenize(req.text));
    let best: { key: string; confidence: number; matched: string[] } | null = null;
    for (const label of req.labels) {
      const labelTokens = [...new Set([...tokenize(label.key), ...tokenize(label.description ?? "")])];
      if (!labelTokens.length) continue;
      const matched = labelTokens.filter((t) => textTokens.has(t));
      const confidence = matched.length / labelTokens.length;
      if (confidence > 0 && (!best || confidence > best.confidence)) best = { key: label.key, confidence, matched };
    }
    if (!best) {
      return { label: null, confidence: 0, reason: "No keyword overlap between text and any label.", model: this.info };
    }
    return {
      label: best.key,
      confidence: round(best.confidence),
      reason: `Keyword overlap with "${best.key}": ${best.matched.join(", ")}.`,
      model: this.info,
    };
  }

  async extract<T>(text: string, schema: z.ZodType<T>, _instructions?: string): Promise<{ data: T | null; confidence: number; model: ModelInfo }> {
    const shape = objectShape(schema);
    if (!shape) return { data: null, confidence: 0, model: this.info };
    const candidate: Record<string, unknown> = {};
    let filled = 0;
    for (const { key, schema: child } of shape) {
      const raw = extractFieldByName(key, text);
      if (raw === null) {
        if (child.isOptional() || child.isNullable()) candidate[key] = child.isNullable() ? null : undefined;
        continue;
      }
      const value = coerceForSchema(raw, child);
      if (value === null || value === undefined) continue;
      candidate[key] = value;
      filled++;
    }
    const parsed = schema.safeParse(candidate);
    if (!parsed.success || filled === 0) return { data: null, confidence: 0, model: this.info };
    return { data: parsed.data, confidence: round(filled / shape.length), model: this.info };
  }

  // ---- VerificationModel -------------------------------------------------

  async verify(req: VerificationRequest): Promise<VerificationResponse> {
    const issues: string[] = [];
    let checked = 0;
    for (const check of req.numbersToCheck ?? []) {
      checked++;
      const claimed = parseLooseNumber(check.claimed);
      const computed = parseLooseNumber(check.computed);
      if (claimed === null || computed === null) {
        issues.push(`${check.label}: could not parse claimed "${check.claimed}" or computed "${check.computed}" as a number.`);
        continue;
      }
      if (!numbersMatch(claimed, computed)) {
        issues.push(`${check.label}: claimed ${check.claimed} but computed ${check.computed}.`);
      }
    }
    const evidence = req.evidence.filter((e) => e.content.trim().length > 0);
    if (issues.length) {
      return { verdict: "CONTRADICTED", issues, confidence: 1, model: this.info };
    }
    if (!evidence.length) {
      return {
        verdict: "INSUFFICIENT_EVIDENCE",
        issues: ["No evidence was supplied for the claim."],
        confidence: checked ? 0.5 : 0.2,
        model: this.info,
      };
    }
    const claimTokens = new Set(tokenize(req.claim));
    const evidenceTokens = new Set(evidence.flatMap((e) => tokenize(e.content)));
    const overlap = [...claimTokens].filter((t) => evidenceTokens.has(t)).length;
    const overlapRatio = claimTokens.size ? overlap / claimTokens.size : 0;
    const confidence = round(checked ? 0.6 + 0.4 * overlapRatio : 0.3 + 0.7 * overlapRatio);
    return { verdict: "SUPPORTED", issues: [], confidence, model: this.info };
  }

  // ---- EmbeddingProvider -------------------------------------------------

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashedBagOfWords(t, this.dimensions));
  }
}

export function numbersMatch(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= VERIFY_ABS_TOLERANCE || diff <= VERIFY_REL_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

/** Deterministic hashed bag-of-words embedding, L2-normalised (zero vector for empty text). */
export function hashedBagOfWords(text: string, dimensions: number): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  for (const token of tokenize(text, { dropStopWords: false })) {
    const h = fnv1a32(token);
    const index = h % dimensions;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    vec[index] += sign;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vec : vec.map((v) => v / norm);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function createLocalProvider(): LocalDeterministicProvider {
  return new LocalDeterministicProvider();
}
