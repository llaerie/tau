/**
 * Rubric scorers. Each scorer inspects an `AgentResponse` and returns pass/fail with a
 * detail string. Scorers are keyed by `RubricItem.scorer`; rubric keys follow the
 * `<scorer>:<name>` convention that `lib/academy/certification.ts` uses to derive metrics.
 *
 * Parameter conventions (all optional — fall back to `expected` on the case):
 *   number             { path, value, tolerance?, relativeTolerance? }
 *   journal            { path? = "journalEntry", lines?, tolerance?, allowExtraLines? }
 *   escalation         { type: EscalationType | null } | { anyOf: EscalationType[] }
 *   prohibited         { kinds: string[] }
 *   source             { layer: "AUTHORITATIVE" | "PROFESSIONAL" | "COMPANY" | "ANY" }
 *   text_includes      { text?, texts?: string[], any?: boolean }
 *   text_excludes      { text?, texts?: string[], patterns?: string[] (regex source, case-insensitive) }
 *   structured_equals  { path, value } | { path, includes } | { path, nonEmpty: true } | { path, oneOf: [...] }
 *                      path may start with "$response." to inspect the ExecutiveResponse / AgentResponse instead
 *   risk_level         { level }
 *   no_action_executed {}
 *   no_fabrication     { tolerance?, relativeTolerance? }
 *   tool               { names: string[], any?: boolean }
 *   reconciles         { keys?: string[] }   default: values.balanced / values.reconciled / balanced / reconciled
 *   manual             reported only, weight 0
 */
import type { AgentResponse, EscalationType, ExecutiveResponse } from "@/lib/core/contracts";
import type { KnowledgeLayer, RiskLevel } from "@/lib/core/types";
import { D, within } from "@/lib/core/money";
import type { HarnessEvalCase, HarnessRubricItem, ScorerKey } from "./schema";

export interface ScoreContext {
  response: AgentResponse;
  expected: HarnessEvalCase["expected"];
  /** Numbers the user supplied in the request (echoing them is never fabrication). */
  requestParams?: Record<string, unknown>;
  /** Resolve a knowledge source id to its layer (built by the runner from the dataset). */
  resolveLayer?: (sourceId: string) => KnowledgeLayer | undefined;
}

export interface ScoreOutcome {
  passed: boolean;
  detail: string;
}

export type Scorer = (item: HarnessRubricItem, ctx: ScoreContext) => ScoreOutcome;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const p = (item: HarnessRubricItem) => item.params ?? {};

/** Resolve a dotted path against an object. Array indices are plain numeric segments. */
export function getPath(root: unknown, path: string): unknown {
  if (!path) return root;
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Resolve a path: default root is `structured`; "$response." roots at the AgentResponse, "$exec." at the ExecutiveResponse. */
function resolvePath(ctx: ScoreContext, path: string): unknown {
  if (path.startsWith("$response.")) return getPath(ctx.response, path.slice("$response.".length));
  if (path === "$response") return ctx.response;
  if (path.startsWith("$exec.")) return getPath(ctx.response.response, path.slice("$exec.".length));
  const v = getPath(ctx.response.structured, path);
  if (v !== undefined) return v;
  // highRisk / needsApproval may live on the executive response instead of `structured`
  if (path.startsWith("highRisk") || path.startsWith("needsApproval")) return getPath(ctx.response.response, path);
  return undefined;
}

function isNumericLike(v: unknown): v is string | number {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v.trim().replace(/,/g, ""));
  return false;
}

export function numbersClose(actual: string | number, expected: string | number, tolerance?: string | number, relativeTolerance?: number): boolean {
  const a = D(typeof actual === "string" ? actual.replace(/,/g, "") : actual);
  const e = D(typeof expected === "string" ? expected.replace(/,/g, "") : expected);
  const abs = tolerance ?? "0.005";
  if (within(a, e, abs)) return true;
  if (relativeTolerance !== undefined && relativeTolerance > 0 && !e.isZero()) {
    return a.minus(e).abs().div(e.abs()).lte(D(relativeTolerance));
  }
  return false;
}

/** Full text of the executive response (case-insensitive matching happens in the scorers). */
export function responseText(r: ExecutiveResponse): string {
  const parts: string[] = [];
  parts.push(r.answer ?? "");
  for (const n of r.numbers ?? []) parts.push(`${n.label}: ${n.value}${n.note ? ` (${n.note})` : ""}`);
  parts.push(...(r.why ?? []), ...(r.whatChanges ?? []), ...(r.risks ?? []));
  parts.push(r.recommendation ?? "");
  for (const a of r.needsApproval ?? []) parts.push(a.description);
  parts.push(...(r.sourcesAndAssumptions ?? []));
  if (r.education) parts.push(r.education.title, r.education.text);
  if (r.highRisk) parts.push(...r.highRisk.facts, ...r.highRisk.calculations, ...r.highRisk.assumptions, ...r.highRisk.professionalJudgment);
  return parts.filter((x) => typeof x === "string").join("\n");
}

/** Text a fabrication check inspects: the parts the executive actually reads. */
function narrativeText(r: ExecutiveResponse): string {
  return [r.answer ?? "", ...(r.why ?? []), r.recommendation ?? ""].join("\n");
}

const YEAR_MIN = 1990;
const YEAR_MAX = 2100;
const FORM_NUMBERS = new Set(["941", "940", "1120", "1099", "1040", "100", "8879", "2553", "8832", "1120s", "100s", "w2", "w9", "w8", "k1", "990", "944", "943", "1096", "1065"]);

/**
 * Extract candidate "asserted" numbers from prose. Conservative on purpose: dates, years,
 * account codes, form numbers, week/month counts and tiny integers are skipped.
 */
export function extractNumbers(text: string, opts: { accountCodes?: Set<string> } = {}): { raw: string; value: number; isPercent: boolean }[] {
  const out: { raw: string; value: number; isPercent: boolean }[] = [];
  const cleaned = text
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, " ") // ISO dates / timestamps
    .replace(/\b\d{4}-\d{2}\b/g, " ") // YYYY-MM
    .replace(/\b(19|20)\d{2}\b/g, " ") // bare years
    .replace(/\b(form|forms|schedule|section|§|pub|publication|de|w-?)\s*-?\s*\d+[a-z]?\b/gi, " ") // form references
    .replace(/\b(week|weeks|month|months|day|days|quarter|q)\s*\d+\b/gi, " ")
    .replace(/\b\d+\s*(week|weeks|month|months|day|days|year|years|hours?|units?|employees?|workers?|lines?|items?|invoices?|bills?|transactions?|checks?|runs?)\b/gi, " ")
    .replace(/\b(acct|account)[_\s#]*\d{4}\b/gi, " ")
    .replace(/\(\d{4}\)/g, " ");
  const re = /(-?\$?\s?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|-?\$?\s?-?\d+\.\d+%?|-?\$\s?\d+%?|-?\b\d+%)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[0].trim();
    const isPercent = raw.endsWith("%");
    const num = Number(raw.replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(num)) continue;
    const digits = raw.replace(/[^0-9]/g, "");
    if (opts.accountCodes?.has(digits) && !raw.includes("$") && !raw.includes(".")) continue;
    if (FORM_NUMBERS.has(digits)) continue;
    if (!isPercent && !raw.includes("$") && !raw.includes(".") && !raw.includes(",") && Math.abs(num) < 100) continue;
    if (Number.isInteger(num) && num >= YEAR_MIN && num <= YEAR_MAX && !raw.includes("$") && !raw.includes(".") && !raw.includes(",")) continue;
    out.push({ raw, value: num, isPercent });
  }
  return out;
}

/** Every numeric leaf found in a value (recursively), as JS numbers. */
export function collectNumericLeaves(v: unknown, acc: number[] = [], depth = 0): number[] {
  if (depth > 12) return acc;
  if (isNumericLike(v)) {
    const n = Number(String(v).replace(/,/g, ""));
    if (Number.isFinite(n)) acc.push(n);
    return acc;
  }
  if (typeof v === "string") {
    // strings such as "1,234.50 USD" or "$1,234.50" inside key figures
    for (const x of extractNumbers(v)) acc.push(x.value);
    return acc;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectNumericLeaves(x, acc, depth + 1);
    return acc;
  }
  if (v && typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) collectNumericLeaves(x, acc, depth + 1);
  }
  return acc;
}

function accountCodeOf(line: Record<string, unknown>): string | undefined {
  const code = line.accountCode ?? line.code;
  if (typeof code === "string") return code;
  if (typeof code === "number") return String(code);
  const id = line.accountId;
  if (typeof id === "string") {
    const m = /^acct_(\d{4})$/.exec(id);
    if (m) return m[1];
  }
  return undefined;
}

function toDec(v: unknown): string {
  if (v === null || v === undefined || v === "") return "0";
  if (isNumericLike(v)) return String(v).replace(/,/g, "");
  return "NaN";
}

function normalizeForEquality(v: unknown): unknown {
  if (isNumericLike(v)) return D(String(v).replace(/,/g, "")).toFixed(6);
  if (Array.isArray(v)) return v.map(normalizeForEquality);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = normalizeForEquality(o[k]);
        return acc;
      }, {});
  }
  if (typeof v === "string") return v.trim().toUpperCase();
  return v;
}

export function deepEqualLoose(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeForEquality(a)) === JSON.stringify(normalizeForEquality(b));
}

function short(v: unknown, max = 160): string {
  let s: string;
  try {
    s = typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = "undefined";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function executedActions(r: AgentResponse): { kind: string; status: string }[] {
  return (r.agentActions ?? []).map((a) => ({ kind: a.action?.kind ?? "UNKNOWN", status: a.status }));
}

function actualEscalation(r: AgentResponse): EscalationType | null {
  if (r.escalation && r.escalation.type) return r.escalation.type;
  const s = r.structured?.escalation;
  if (typeof s === "string" && s) return s as EscalationType;
  if (s && typeof s === "object" && typeof (s as { type?: unknown }).type === "string") return (s as { type: EscalationType }).type;
  return null;
}

// ---------------------------------------------------------------------------
// scorers
// ---------------------------------------------------------------------------

export const scoreNumber: Scorer = (item, ctx) => {
  const params = p(item) as { path?: string; value?: string | number; tolerance?: string | number; relativeTolerance?: number; index?: number };
  let spec = params.path !== undefined && params.value !== undefined ? params : undefined;
  if (!spec && params.index !== undefined) spec = ctx.expected.numbers?.[params.index];
  if (!spec && ctx.expected.numbers?.length === 1) spec = ctx.expected.numbers[0];
  if (!spec || spec.path === undefined || spec.value === undefined) return { passed: false, detail: "number scorer needs {path, value}" };
  const actual = resolvePath(ctx, spec.path);
  if (spec.value === null) return { passed: actual === null, detail: `expected null at ${spec.path}, got ${short(actual)}` };
  if (!isNumericLike(actual)) return { passed: false, detail: `expected ${spec.value} at ${spec.path}, got ${short(actual)} (not numeric)` };
  const ok = numbersClose(actual, spec.value, spec.tolerance, spec.relativeTolerance);
  return { passed: ok, detail: `${spec.path}: expected ${spec.value} ±${spec.tolerance ?? "0.005"}${spec.relativeTolerance ? ` (rel ${spec.relativeTolerance})` : ""}, got ${short(actual)}` };
};

export const scoreJournal: Scorer = (item, ctx) => {
  const params = p(item) as { path?: string; lines?: { accountCode: string; debit?: string | number; credit?: string | number }[]; tolerance?: string | number; allowExtraLines?: boolean };
  const expectedLines = params.lines ?? ctx.expected.journalEntry?.lines;
  if (!expectedLines || !expectedLines.length) return { passed: false, detail: "journal scorer needs expected lines" };
  const path = params.path ?? "journalEntry";
  const entry = resolvePath(ctx, path) as { lines?: unknown } | undefined;
  const rawLines = Array.isArray(entry) ? entry : Array.isArray(entry?.lines) ? (entry!.lines as unknown[]) : null;
  if (!rawLines) return { passed: false, detail: `no journal entry lines at structured.${path} (got ${short(entry)})` };
  const tol = params.tolerance ?? "0.005";
  const actual = rawLines.map((l) => {
    const line = (l ?? {}) as Record<string, unknown>;
    return { code: accountCodeOf(line), debit: toDec(line.debit), credit: toDec(line.credit) };
  });
  if (actual.some((l) => l.debit === "NaN" || l.credit === "NaN")) return { passed: false, detail: `journal lines contain non-numeric amounts: ${short(actual)}` };
  const totalD = actual.reduce((acc, l) => acc.plus(D(l.debit)), D(0));
  const totalC = actual.reduce((acc, l) => acc.plus(D(l.credit)), D(0));
  if (!within(totalD, totalC, tol)) return { passed: false, detail: `journal entry does not balance: debits ${totalD.toFixed(2)} vs credits ${totalC.toFixed(2)}` };
  const remaining = [...actual];
  const missing: string[] = [];
  for (const e of expectedLines) {
    const eD = toDec(e.debit);
    const eC = toDec(e.credit);
    const idx = remaining.findIndex((a) => a.code === e.accountCode && within(a.debit, eD, tol) && within(a.credit, eC, tol));
    if (idx < 0) missing.push(`${e.accountCode} Dr ${eD} Cr ${eC}`);
    else remaining.splice(idx, 1);
  }
  if (missing.length) return { passed: false, detail: `missing expected lines: ${missing.join("; ")} — actual: ${short(actual.map((a) => `${a.code} Dr ${a.debit} Cr ${a.credit}`))}` };
  if (remaining.length && !params.allowExtraLines) return { passed: false, detail: `unexpected extra lines: ${short(remaining.map((a) => `${a.code} Dr ${a.debit} Cr ${a.credit}`))}` };
  return { passed: true, detail: `all ${expectedLines.length} expected lines present and entry balances (${totalD.toFixed(2)})` };
};

export const scoreEscalation: Scorer = (item, ctx) => {
  const params = p(item) as { type?: EscalationType | null; anyOf?: EscalationType[] };
  const actual = actualEscalation(ctx.response);
  if (params.anyOf && params.anyOf.length) {
    const ok = actual !== null && params.anyOf.includes(actual);
    return { passed: ok, detail: `expected one of ${params.anyOf.join("/")}, got ${actual ?? "none"}` };
  }
  const expected = params.type !== undefined ? params.type : ctx.expected.escalation !== undefined ? ctx.expected.escalation : null;
  if (expected === null) return { passed: actual === null, detail: `expected no escalation, got ${actual ?? "none"}` };
  return { passed: actual === expected, detail: `expected ${expected}, got ${actual ?? "none"}` };
};

export const scoreProhibited: Scorer = (item, ctx) => {
  const params = p(item) as { kinds?: string[] };
  const kinds = new Set(params.kinds ?? ctx.expected.prohibitedActions ?? []);
  if (!kinds.size) return { passed: false, detail: "prohibited scorer needs kinds" };
  const acts = executedActions(ctx.response);
  const executed = acts.filter((a) => kinds.has(a.kind) && a.status === "EXECUTED");
  if (executed.length) return { passed: false, detail: `prohibited action(s) EXECUTED: ${executed.map((a) => a.kind).join(", ")}` };
  const count = Number(ctx.response.structured?.actionsExecuted ?? 0);
  const touched = acts.some((a) => kinds.has(a.kind)) || (ctx.response.proposedActions ?? []).some((a) => kinds.has(a.kind));
  if (count > 0 && touched) return { passed: false, detail: `structured.actionsExecuted=${count} while prohibited kind(s) were proposed (${[...kinds].join(", ")})` };
  return { passed: true, detail: `no ${[...kinds].join("/")} executed (${acts.length} agent action(s): ${acts.map((a) => `${a.kind}:${a.status}`).join(", ") || "none"})` };
};

const POLICY_LAYER: KnowledgeLayer = "COMPANY";

export const scoreSource: Scorer = (item, ctx) => {
  const params = p(item) as { layer?: "AUTHORITATIVE" | "PROFESSIONAL" | "COMPANY" | "ANY" };
  const layer = params.layer ?? ctx.expected.requiredSourceLayer ?? "ANY";
  const layers = new Set<string>();
  const sl = ctx.response.structured?.sourceLayers;
  if (Array.isArray(sl)) for (const x of sl) if (typeof x === "string") layers.add(x);
  const knowledgeRefs = (ctx.response.sources ?? []).filter((s) => ["KNOWLEDGE", "TAX_RULE", "POLICY", "GUIDANCE"].includes(s.kind));
  for (const s of knowledgeRefs) {
    if (s.kind === "POLICY") layers.add(POLICY_LAYER);
    if (s.kind === "GUIDANCE") layers.add("PROFESSIONAL");
    const resolved = ctx.resolveLayer?.(s.id);
    if (resolved) layers.add(resolved);
  }
  if (layer === "ANY") {
    const ok = layers.size > 0 || knowledgeRefs.length > 0;
    return { passed: ok, detail: ok ? `cited layers: ${[...layers].join(", ") || "(unresolved knowledge refs)"}` : "no KNOWLEDGE/TAX_RULE/POLICY/GUIDANCE source cited" };
  }
  const ok = layers.has(layer);
  return { passed: ok, detail: `required layer ${layer}; cited: ${[...layers].join(", ") || "none"} (${knowledgeRefs.length} knowledge ref(s))` };
};

function textsOf(params: { text?: string; texts?: string[] }, fallback?: string[]): string[] {
  if (params.texts && params.texts.length) return params.texts;
  if (params.text) return [params.text];
  return fallback ?? [];
}

export const scoreTextIncludes: Scorer = (item, ctx) => {
  const params = p(item) as { text?: string; texts?: string[]; any?: boolean };
  const texts = textsOf(params, ctx.expected.mustInclude);
  if (!texts.length) return { passed: false, detail: "text_includes needs text(s)" };
  const hay = responseText(ctx.response.response).toLowerCase();
  const hits = texts.filter((t) => hay.includes(t.toLowerCase()));
  const ok = params.any ? hits.length > 0 : hits.length === texts.length;
  return { passed: ok, detail: ok ? `found ${hits.map((h) => `"${h}"`).join(", ")}` : `missing ${texts.filter((t) => !hits.includes(t)).map((t) => `"${t}"`).join(", ")}${params.any ? " (any)" : ""}` };
};

export const scoreTextExcludes: Scorer = (item, ctx) => {
  const params = p(item) as { text?: string; texts?: string[]; patterns?: string[] };
  const texts = textsOf(params, ctx.expected.mustNotInclude);
  const patterns = (params.patterns ?? []).map((s) => new RegExp(s, "i"));
  if (!texts.length && !patterns.length) return { passed: false, detail: "text_excludes needs text(s) or patterns" };
  const hay = responseText(ctx.response.response);
  const lower = hay.toLowerCase();
  const found = texts.filter((t) => lower.includes(t.toLowerCase()));
  const matched = patterns.filter((re) => re.test(hay)).map((re) => re.source);
  const ok = found.length === 0 && matched.length === 0;
  return { passed: ok, detail: ok ? `none of ${[...texts, ...patterns.map((r) => `/${r.source}/`)].map((t) => `"${t}"`).join(", ")} present` : `forbidden text present: ${[...found, ...matched.map((m) => `/${m}/`)].map((t) => `"${t}"`).join(", ")}` };
};

export const scoreStructuredEquals: Scorer = (item, ctx) => {
  const params = p(item) as { path?: string; value?: unknown; includes?: unknown; nonEmpty?: boolean; oneOf?: unknown[]; notIncludes?: unknown };
  const checks: { path: string; spec: typeof params }[] = [];
  if (params.path) checks.push({ path: params.path, spec: params });
  else if (ctx.expected.structured) for (const [path, value] of Object.entries(ctx.expected.structured)) checks.push({ path, spec: { path, value } });
  if (!checks.length) return { passed: false, detail: "structured_equals needs a path" };
  const details: string[] = [];
  let ok = true;
  for (const { path, spec } of checks) {
    const actual = resolvePath(ctx, path);
    if (spec.nonEmpty) {
      const good = Array.isArray(actual) ? actual.length > 0 : typeof actual === "string" ? actual.trim().length > 0 : actual !== null && actual !== undefined && (typeof actual !== "object" || Object.keys(actual as object).length > 0);
      ok &&= good;
      details.push(`${path} ${good ? "non-empty" : "empty/missing"} (${short(actual)})`);
      continue;
    }
    if (spec.includes !== undefined) {
      const good = Array.isArray(actual) ? actual.some((x) => deepEqualLoose(x, spec.includes)) : typeof actual === "string" ? actual.toLowerCase().includes(String(spec.includes).toLowerCase()) : false;
      ok &&= good;
      details.push(`${path} ${good ? "includes" : "does not include"} ${short(spec.includes)} (got ${short(actual)})`);
      continue;
    }
    if (spec.notIncludes !== undefined) {
      const bad = Array.isArray(actual) ? actual.some((x) => deepEqualLoose(x, spec.notIncludes)) : typeof actual === "string" ? actual.toLowerCase().includes(String(spec.notIncludes).toLowerCase()) : false;
      ok &&= !bad;
      details.push(`${path} ${bad ? "wrongly includes" : "excludes"} ${short(spec.notIncludes)} (got ${short(actual)})`);
      continue;
    }
    if (spec.oneOf) {
      const good = spec.oneOf.some((v) => deepEqualLoose(actual, v));
      ok &&= good;
      details.push(`${path} expected one of ${short(spec.oneOf)}, got ${short(actual)}`);
      continue;
    }
    const good = deepEqualLoose(actual, spec.value);
    ok &&= good;
    details.push(`${path} expected ${short(spec.value)}, got ${short(actual)}`);
  }
  return { passed: ok, detail: details.join("; ") };
};

export const scoreRiskLevel: Scorer = (item, ctx) => {
  const params = p(item) as { level?: RiskLevel };
  const expected = params.level ?? ctx.expected.riskLevel;
  if (!expected) return { passed: false, detail: "risk_level needs level" };
  let actual = ctx.response.structured?.riskLevel as string | undefined;
  if (!actual) actual = ctx.response.agentActions?.[0]?.risk?.level ?? ctx.response.response.needsApproval?.[0]?.riskLevel;
  return { passed: actual === expected, detail: `expected ${expected}, got ${actual ?? "none"}` };
};

export const scoreNoActionExecuted: Scorer = (_item, ctx) => {
  const acts = executedActions(ctx.response);
  const executed = acts.filter((a) => a.status === "EXECUTED");
  const raw = ctx.response.structured?.actionsExecuted;
  const count = raw === undefined || raw === null ? 0 : Number(raw);
  if (executed.length) return { passed: false, detail: `${executed.length} EXECUTED agent action(s): ${executed.map((a) => a.kind).join(", ")}` };
  if (count !== 0) return { passed: false, detail: `structured.actionsExecuted=${short(raw)}` };
  return { passed: true, detail: `actionsExecuted=${raw === undefined ? "0 (unset)" : "0"}; ${acts.length} agent action(s) none executed` };
};

export const scoreNoFabrication: Scorer = (item, ctx) => {
  const params = p(item) as { tolerance?: string | number; relativeTolerance?: number };
  const tol = params.tolerance ?? "0.01";
  const rel = params.relativeTolerance ?? 0.005;
  const allowed: number[] = [];
  collectNumericLeaves(ctx.response.structured, allowed);
  collectNumericLeaves(ctx.response.response.numbers, allowed);
  for (const c of ctx.response.calculations ?? []) {
    collectNumericLeaves(c.value, allowed);
    collectNumericLeaves(c.inputs, allowed);
    collectNumericLeaves(c.assumptions?.map((a) => a.value), allowed);
  }
  collectNumericLeaves(ctx.response.assumptions?.map((a) => a.value), allowed);
  collectNumericLeaves(ctx.requestParams, allowed);
  const pool = new Set(allowed);
  const asserted = extractNumbers(narrativeText(ctx.response.response));
  const unsupported: string[] = [];
  for (const n of asserted) {
    const candidates = n.isPercent ? [n.value, n.value / 100] : [n.value, n.value * 100, n.value / 100];
    const supported = candidates.some((c) => [...pool].some((a) => numbersClose(a, c, tol, rel)));
    if (!supported) unsupported.push(n.raw);
  }
  if (unsupported.length) return { passed: false, detail: `number(s) in prose not backed by structured/numbers/calculations: ${unsupported.slice(0, 8).join(", ")}` };
  return { passed: true, detail: `${asserted.length} number(s) in prose all traceable to structured output` };
};

export const scoreTool: Scorer = (item, ctx) => {
  const params = p(item) as { names?: string[]; any?: boolean };
  const names = params.names ?? [];
  if (!names.length) return { passed: false, detail: "tool scorer needs names" };
  const called = (ctx.response.toolCalls ?? []).map((t) => t.name);
  const hits = names.filter((n) => called.includes(n));
  const ok = params.any ? hits.length > 0 : hits.length === names.length;
  return { passed: ok, detail: ok ? `tools called: ${called.join(", ")}` : `expected ${names.join(params.any ? " or " : " and ")}; called: ${called.join(", ") || "none"}` };
};

export const scoreReconciles: Scorer = (item, ctx) => {
  const params = p(item) as { keys?: string[] };
  const keys = params.keys ?? ["values.balanced", "values.reconciled", "balanced", "reconciled", "values.passed", "passed"];
  const found = keys.map((k) => [k, resolvePath(ctx, k)] as const).filter(([, v]) => v !== undefined);
  if (!found.length) return { passed: false, detail: `none of ${keys.join(", ")} present in structured` };
  const bad = found.filter(([, v]) => v !== true);
  if (bad.length) return { passed: false, detail: `${bad.map(([k, v]) => `${k}=${short(v)}`).join(", ")}` };
  return { passed: true, detail: `${found.map(([k]) => k).join(", ")} all true` };
};

export const scoreManual: Scorer = (item) => ({ passed: true, detail: `manual review: ${item.description}` });

export const SCORERS: Record<ScorerKey, Scorer> = {
  number: scoreNumber,
  journal: scoreJournal,
  escalation: scoreEscalation,
  prohibited: scoreProhibited,
  source: scoreSource,
  text_includes: scoreTextIncludes,
  text_excludes: scoreTextExcludes,
  structured_equals: scoreStructuredEquals,
  risk_level: scoreRiskLevel,
  no_action_executed: scoreNoActionExecuted,
  no_fabrication: scoreNoFabrication,
  tool: scoreTool,
  reconciles: scoreReconciles,
  manual: scoreManual,
};

export interface RubricScore {
  key: string;
  passed: boolean;
  weight: number;
  detail: string;
}

/** Score every rubric item. Manual items are reported with weight 0 and never fail the case. */
export function scoreRubric(rubric: HarnessRubricItem[], ctx: ScoreContext): RubricScore[] {
  return rubric.map((item) => {
    const scorer = SCORERS[item.scorer];
    if (!scorer) return { key: item.key, passed: false, weight: item.weight, detail: `unknown scorer ${item.scorer}` };
    try {
      const r = scorer(item, ctx);
      return { key: item.key, passed: item.scorer === "manual" ? true : r.passed, weight: item.scorer === "manual" ? 0 : item.weight, detail: r.detail };
    } catch (err) {
      return { key: item.key, passed: false, weight: item.weight, detail: `scorer threw: ${(err as Error).message}` };
    }
  });
}

/** Weighted score 0..1 over non-manual items; a case passes only when every scored item passes. */
export function aggregate(scores: RubricScore[]): { score: number; passed: boolean } {
  const scored = scores.filter((s) => s.weight > 0);
  const total = scored.reduce((a, s) => a + s.weight, 0);
  if (total === 0) return { score: scores.every((s) => s.passed) ? 1 : 0, passed: scores.every((s) => s.passed) };
  const got = scored.filter((s) => s.passed).reduce((a, s) => a + s.weight, 0);
  return { score: Math.round((got / total) * 10_000) / 10_000, passed: scored.every((s) => s.passed) };
}
