/**
 * Eval case schema and validation.
 *
 * The harness accepts the contract `EvalCase` (lib/core/contracts) plus three extra
 * scorer keys the certification metrics already understand (`no_fabrication`, `tool`,
 * `reconciles` — see lib/academy/certification.ts `metricsFromResults`). The widened
 * types below are structurally identical to the contract apart from `rubric[].scorer`.
 */
import { z } from "zod";
import type { EvalCase as ContractEvalCase, EvalDirectory, RubricItem } from "@/lib/core/contracts";
import { COMPETENCY_BY_KEY, DOMAINS } from "@/lib/academy/competency-map";
import { isCapabilityKey } from "@/lib/academy/capabilities";
import { isTaskKind } from "@/lib/agents/task-catalog";

export const SCORER_KEYS = [
  "number",
  "journal",
  "escalation",
  "prohibited",
  "source",
  "text_includes",
  "text_excludes",
  "structured_equals",
  "risk_level",
  "no_action_executed",
  "no_fabrication",
  "tool",
  "reconciles",
  "manual",
] as const;
export type ScorerKey = (typeof SCORER_KEYS)[number];

export interface HarnessRubricItem extends Omit<RubricItem, "scorer"> {
  scorer: ScorerKey;
}

export interface HarnessEvalCase extends Omit<ContractEvalCase, "rubric"> {
  rubric: HarnessRubricItem[];
}

/** Alias used throughout the harness and generators. */
export type EvalCase = HarnessEvalCase;

export const EVAL_DIRECTORIES: EvalDirectory[] = ["accounting", "fpa", "cash", "tax", "payroll", "ap_ar", "strategy", "compliance", "adversarial"];

const DOMAIN_KEYS = DOMAINS.map((d) => d.domain);
const ESCALATIONS = ["INSUFFICIENT_INFORMATION", "CPA_REVIEW_REQUIRED", "CANNOT_CLASSIFY", "APPROVAL_REQUIRED", "PROFESSIONAL_REVIEW_REQUIRED", "REFUSED_CONTROL_VIOLATION", "OUT_OF_SCOPE"] as const;
const ROLES = ["OWNER", "FINANCE_OPERATOR", "CPA", "PAYROLL_PROFESSIONAL", "ATTORNEY", "AUDITOR", "VIEWER", "SYSTEM", "AGENT"] as const;
const AGENTS = ["cfo_orchestrator", "controller", "bookkeeping", "fpa", "treasury", "ap", "ar", "payroll", "tax", "documents", "strategy", "auditor"] as const;

const decimalOrNumber = z.union([z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string"), z.number().finite()]);

export const expectedNumberSchema = z.object({
  path: z.string().min(1),
  value: decimalOrNumber,
  tolerance: decimalOrNumber.optional(),
  relativeTolerance: z.number().min(0).optional(),
});

export const expectedJournalLineSchema = z
  .object({
    accountCode: z.string().regex(/^\d{4}$/, "4-digit account code"),
    debit: decimalOrNumber.optional(),
    credit: decimalOrNumber.optional(),
  })
  .refine((l) => (l.debit !== undefined) !== (l.credit !== undefined), { message: "exactly one of debit/credit" });

export const rubricItemSchema = z.object({
  key: z.string().regex(/^[a-z_]+:[A-Za-z0-9_.+\-]+$/, "rubric key must be <scorer>:<name>"),
  description: z.string().min(1),
  weight: z.number().min(0),
  scorer: z.enum(SCORER_KEYS),
  params: z.record(z.unknown()).optional(),
});

export const evalCaseSchema = z
  .object({
    id: z.string().min(1),
    directory: z.enum(EVAL_DIRECTORIES as [EvalDirectory, ...EvalDirectory[]]),
    domain: z.enum(DOMAIN_KEYS as [string, ...string[]]),
    competency: z.string().min(1),
    capabilityKey: z.string().min(1),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    title: z.string().min(1),
    scenario: z.string().min(1),
    request: z.object({
      message: z.string().min(1),
      task: z.object({ kind: z.string().min(1), params: z.record(z.unknown()).optional() }).optional(),
      actorRole: z.enum(ROLES).optional(),
      targetAgent: z.enum(AGENTS).optional(),
    }),
    fixture: z.string().min(1),
    sourceDocumentIds: z.array(z.string()).optional(),
    expected: z.object({
      numbers: z.array(expectedNumberSchema).optional(),
      journalEntry: z.object({ lines: z.array(expectedJournalLineSchema).min(2), mustBalance: z.literal(true) }).optional(),
      escalation: z.enum(ESCALATIONS).nullable().optional(),
      prohibitedActions: z.array(z.string()).optional(),
      requiredSourceLayer: z.enum(["AUTHORITATIVE", "PROFESSIONAL", "COMPANY", "ANY"]).optional(),
      riskLevel: z.enum(["GREEN", "YELLOW", "RED"]).optional(),
      mustInclude: z.array(z.string()).optional(),
      mustNotInclude: z.array(z.string()).optional(),
      structured: z.record(z.unknown()).optional(),
      noActionExecuted: z.boolean().optional(),
    }),
    rubric: z.array(rubricItemSchema).min(1),
    tags: z.array(z.string()),
    generatedFrom: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    const comp = COMPETENCY_BY_KEY[c.competency];
    if (!comp) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["competency"], message: `Unknown competency key ${c.competency}` });
    else if (comp.domain !== c.domain) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["domain"], message: `Competency ${c.competency} belongs to ${comp.domain}, not ${c.domain}` });
    if (!isCapabilityKey(c.capabilityKey)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["capabilityKey"], message: `Unknown capability key ${c.capabilityKey}` });
    if (c.request.task && !isTaskKind(c.request.task.kind)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["request", "task", "kind"], message: `Unknown task kind ${c.request.task.kind}` });
    if (c.expected.journalEntry) {
      const sumD = c.expected.journalEntry.lines.reduce((a, l) => a + Number(l.debit ?? 0), 0);
      const sumC = c.expected.journalEntry.lines.reduce((a, l) => a + Number(l.credit ?? 0), 0);
      if (Math.abs(sumD - sumC) > 0.005) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expected", "journalEntry"], message: `Expected journal entry does not balance (${sumD} vs ${sumC})` });
    }
    const scored = c.rubric.filter((r) => r.scorer !== "manual");
    if (scored.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rubric"], message: "At least one non-manual rubric item is required" });
    for (const [i, r] of c.rubric.entries()) {
      if (!r.key.startsWith(`${r.scorer}:`)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rubric", i, "key"], message: `Rubric key ${r.key} must start with "${r.scorer}:"` });
      if (r.scorer === "manual" && r.weight !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rubric", i, "weight"], message: "manual rubric items carry weight 0" });
    }
  });

export type ValidatedEvalCase = z.infer<typeof evalCaseSchema>;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Validate a case; returns a list of human-readable errors (empty when valid). */
export function validateCase(input: unknown): ValidationResult {
  const r = evalCaseSchema.safeParse(input);
  if (r.success) return { ok: true, errors: [] };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`) };
}

/** Parse-or-throw variant used by the loaders. */
export function assertValidCase(input: unknown, context = "case"): HarnessEvalCase {
  const v = validateCase(input);
  if (!v.ok) throw new Error(`Invalid eval ${context}: ${v.errors.join("; ")}`);
  return input as HarnessEvalCase;
}
