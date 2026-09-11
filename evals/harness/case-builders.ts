/**
 * Small helpers shared by the case generators: deterministic ids, rubric constructors and
 * a `mkCase` that fills the boilerplate and validates the result.
 *
 * Naming convention for `AgentResponse.structured` paths asserted by the generated cases
 * (mirrors the field names of the deterministic engines in lib/finance / lib/forecasting so an
 * agent that returns the engine output verbatim satisfies them):
 *   value                          primary numeric result
 *   values.<engineFieldName>       e.g. values.endingCash, values.lowestCashWeek, values.employerTaxes,
 *                                  values.variancePct, values.favorable, values.simple, values.discounted,
 *                                  values.surplus, values.coverageRatio, values.meetsPolicy, values.buckets.<bucket>
 *   journalEntry.lines[]           { accountCode, debit, credit }
 *   reversalEntry.lines[]          reversal of an accrual
 *   category                       { accountCode, status, confidence, flags[] }
 *   flags[]                        transaction/bill level flags outside a categorization
 *   matchType                      EXACT | PARTIAL | OVERPAYMENT | NONE (payment matching)
 *   riskLevel, requiresApproval, actionsExecuted, escalation, sourceLayers, highRisk
 */
import { deterministicId } from "@/lib/core/ids";
import type { EvalDirectory, EscalationType, ExpectedJournalLine } from "@/lib/core/contracts";
import type { CompetencyDomain, RiskLevel, Role, AgentName } from "@/lib/core/types";
import { COMPETENCY_BY_KEY } from "@/lib/academy/competency-map";
import { capabilityForTask, isTaskKind, type TaskKind } from "@/lib/agents/task-catalog";
import { assertValidCase, type HarnessEvalCase, type HarnessRubricItem } from "./schema";

export const EVAL_ID_NAMESPACE = "tau-evals-v1";

/** Readable, deterministic case id: `<directory>_<slug>_<hash>`. */
export function caseId(directory: EvalDirectory, slug: string, ...parts: (string | number)[]): string {
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return deterministicId(`${directory}_${clean}`, EVAL_ID_NAMESPACE, directory, slug, ...parts);
}

// ---------------------------------------------------------------------------
// rubric constructors
// ---------------------------------------------------------------------------

type P = Record<string, unknown>;
const r = (scorer: HarnessRubricItem["scorer"], name: string, description: string, weight: number, params?: P): HarnessRubricItem => ({ key: `${scorer}:${name}`, description, weight, scorer, params });

export const R = {
  number: (name: string, path: string, value: string | number, opts: { tolerance?: string | number; relativeTolerance?: number; weight?: number; description?: string } = {}) =>
    r("number", name, opts.description ?? `${path} equals ${value}`, opts.weight ?? 3, { path, value, tolerance: opts.tolerance ?? "0.01", ...(opts.relativeTolerance ? { relativeTolerance: opts.relativeTolerance } : {}) }),
  numberNull: (name: string, path: string, opts: { weight?: number; description?: string } = {}) => r("structured_equals", name, opts.description ?? `${path} is null (unknown, never zero)`, opts.weight ?? 3, { path, value: null }),
  journal: (name: string, lines: ExpectedJournalLine[], opts: { path?: string; weight?: number; description?: string; allowExtraLines?: boolean; tolerance?: string } = {}) =>
    r("journal", name, opts.description ?? "journal entry lines match and balance", opts.weight ?? 4, { path: opts.path ?? "journalEntry", lines, tolerance: opts.tolerance ?? "0.01", ...(opts.allowExtraLines ? { allowExtraLines: true } : {}) }),
  escalation: (name: string, type: EscalationType | null, opts: { weight?: number; description?: string } = {}) => r("escalation", name, opts.description ?? (type ? `escalates ${type}` : "no escalation"), opts.weight ?? 3, { type }),
  escalationAnyOf: (name: string, anyOf: EscalationType[], opts: { weight?: number; description?: string } = {}) => r("escalation", name, opts.description ?? `escalates one of ${anyOf.join("/")}`, opts.weight ?? 3, { anyOf }),
  prohibited: (name: string, kinds: string[], opts: { weight?: number; description?: string } = {}) => r("prohibited", name, opts.description ?? `never executes ${kinds.join("/")}`, opts.weight ?? 4, { kinds }),
  source: (name: string, layer: "AUTHORITATIVE" | "PROFESSIONAL" | "COMPANY" | "ANY", opts: { weight?: number; description?: string } = {}) => r("source", name, opts.description ?? `cites a ${layer} source`, opts.weight ?? 2, { layer }),
  includes: (name: string, texts: string[], opts: { any?: boolean; weight?: number; description?: string } = {}) => r("text_includes", name, opts.description ?? `response mentions ${opts.any ? "one of " : ""}${texts.map((t) => `"${t}"`).join(", ")}`, opts.weight ?? 1, { texts, ...(opts.any ? { any: true } : {}) }),
  excludes: (name: string, texts: string[], opts: { patterns?: string[]; weight?: number; description?: string } = {}) => r("text_excludes", name, opts.description ?? `response never says ${[...texts, ...(opts.patterns ?? [])].map((t) => `"${t}"`).join(", ")}`, opts.weight ?? 2, { texts, ...(opts.patterns ? { patterns: opts.patterns } : {}) }),
  excludesPatterns: (name: string, patterns: string[], opts: { weight?: number; description?: string } = {}) => r("text_excludes", name, opts.description ?? `response never matches ${patterns.map((t) => `/${t}/`).join(", ")}`, opts.weight ?? 2, { texts: [], patterns }),
  equals: (name: string, path: string, value: unknown, opts: { weight?: number; description?: string } = {}) => r("structured_equals", name, opts.description ?? `${path} equals ${JSON.stringify(value)}`, opts.weight ?? 3, { path, value }),
  oneOf: (name: string, path: string, oneOf: unknown[], opts: { weight?: number; description?: string } = {}) => r("structured_equals", name, opts.description ?? `${path} is one of ${JSON.stringify(oneOf)}`, opts.weight ?? 3, { path, oneOf }),
  contains: (name: string, path: string, includes: unknown, opts: { weight?: number; description?: string } = {}) => r("structured_equals", name, opts.description ?? `${path} includes ${JSON.stringify(includes)}`, opts.weight ?? 3, { path, includes }),
  notContains: (name: string, path: string, notIncludes: unknown, opts: { weight?: number; description?: string } = {}) => r("structured_equals", name, opts.description ?? `${path} does not include ${JSON.stringify(notIncludes)}`, opts.weight ?? 3, { path, notIncludes }),
  nonEmpty: (name: string, path: string, opts: { weight?: number; description?: string } = {}) => r("structured_equals", name, opts.description ?? `${path} is non-empty`, opts.weight ?? 2, { path, nonEmpty: true }),
  risk: (name: string, level: RiskLevel, opts: { weight?: number; description?: string } = {}) => r("risk_level", name, opts.description ?? `risk level ${level}`, opts.weight ?? 3, { level }),
  noAction: (opts: { weight?: number; description?: string } = {}) => r("no_action_executed", "none", opts.description ?? "no action executed", opts.weight ?? 4),
  noFabrication: (opts: { weight?: number; description?: string } = {}) => r("no_fabrication", "prose-numbers", opts.description ?? "every number in the prose is traceable to structured output", opts.weight ?? 2),
  tool: (name: string, names: string[], opts: { any?: boolean; weight?: number; description?: string } = {}) => r("tool", name, opts.description ?? `calls tool ${names.join(opts.any ? " or " : " and ")}`, opts.weight ?? 1, { names, ...(opts.any ? { any: true } : {}) }),
  reconciles: (name = "statements", opts: { keys?: string[]; weight?: number; description?: string } = {}) => r("reconciles", name, opts.description ?? "output reconciles / balances", opts.weight ?? 3, opts.keys ? { keys: opts.keys } : undefined),
  manual: (name: string, description: string) => r("manual", name, description, 0),
};

// ---------------------------------------------------------------------------
// case constructor
// ---------------------------------------------------------------------------

export interface CaseSpec {
  directory: EvalDirectory;
  slug: string;
  /** extra id parts (e.g. amount, seed index) to keep ids unique across variants */
  idParts?: (string | number)[];
  competency: string;
  /** default: the task's capability from the catalog, else the competency's capability */
  capabilityKey?: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  title: string;
  scenario: string;
  message: string;
  task?: { kind: TaskKind; params?: Record<string, unknown> };
  actorRole?: Role;
  targetAgent?: AgentName;
  fixture?: string;
  expected?: HarnessEvalCase["expected"];
  rubric: HarnessRubricItem[];
  tags?: string[];
  generatedFrom?: string;
  sourceDocumentIds?: string[];
}

export function mkCase(spec: CaseSpec): HarnessEvalCase {
  const comp = COMPETENCY_BY_KEY[spec.competency];
  if (!comp) throw new Error(`mkCase: unknown competency ${spec.competency} (${spec.slug})`);
  const domain: CompetencyDomain = comp.domain;
  const capabilityKey = spec.capabilityKey ?? (spec.task && isTaskKind(spec.task.kind) ? capabilityForTask(spec.task.kind) : comp.capabilityKey);
  const c: HarnessEvalCase = {
    id: caseId(spec.directory, spec.slug, ...(spec.idParts ?? [])),
    directory: spec.directory,
    domain,
    competency: spec.competency,
    capabilityKey,
    difficulty: spec.difficulty,
    title: spec.title,
    scenario: spec.scenario,
    request: { message: spec.message, ...(spec.task ? { task: spec.task } : {}), ...(spec.actorRole ? { actorRole: spec.actorRole } : {}), ...(spec.targetAgent ? { targetAgent: spec.targetAgent } : {}) },
    fixture: spec.fixture ?? "empty",
    ...(spec.sourceDocumentIds ? { sourceDocumentIds: spec.sourceDocumentIds } : {}),
    expected: spec.expected ?? {},
    rubric: spec.rubric,
    tags: Array.from(new Set([spec.directory, ...(spec.task ? [spec.task.kind] : []), ...(spec.tags ?? [])])),
    generatedFrom: spec.generatedFrom ?? `evals/${spec.directory}/generators.ts`,
  };
  return assertValidCase(c, `${spec.directory}/${spec.slug}`);
}

/** Round to cents as a canonical 2-dp string (for generator arithmetic on random amounts). */
export function cents2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Money-ish random amount that is an exact multiple of `step` cents. */
export function roundedAmount(rng: { int(min: number, max: number): number }, min: number, max: number, step = 25): string {
  const lo = Math.ceil(min / step);
  const hi = Math.floor(max / step);
  return (rng.int(lo, hi) * step).toFixed(2);
}
