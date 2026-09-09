/**
 * Versioned prompt templates. Audit records capture `PROMPT_VERSION` (and the per-template
 * version) so that a model output can always be traced to the exact instructions used.
 *
 * Templates use `{{name}}` placeholders rendered by `renderPrompt`. Unknown placeholders are
 * left untouched so that a missing variable is visible rather than silently blank.
 */

export const PROMPT_VERSION = "2026.09-p1";

export interface PromptTemplate {
  name: string;
  version: string;
  description: string;
  template: string;
}

const T = (name: string, description: string, template: string, version = PROMPT_VERSION): PromptTemplate => ({
  name,
  version,
  description,
  template: template.trim(),
});

export const PROMPT_TEMPLATES = {
  "cfo.system": T(
    "cfo.system",
    "Base system prompt for reasoning calls issued by Tau agents.",
    `
You are Tau, the AI CFO for a synthetic training company. You never calculate money yourself:
all figures come from deterministic tools and must be cited by calculation id. Unknown facts stay
unknown; never invent a value. Separate FACT, CALCULATION, ASSUMPTION and PROFESSIONAL JUDGMENT
for high-risk topics. Payments, payroll execution, tax filings, signatures and entity changes are
simulation-only in Phase One and must never be represented as executed.
`,
  ),
  "classify.system": T(
    "classify.system",
    "Instruction for fast single-label classification.",
    `
Classify the text into exactly one of the provided labels. Respond with JSON only:
{"label": <label key or null>, "confidence": <0..1>, "reason": <short reason>}.
Return null for the label when no label fits; do not guess.
`,
  ),
  "classify.user": T(
    "classify.user",
    "User turn for classification: labels then text.",
    `
Labels:
{{labels}}

Text:
{{text}}
`,
  ),
  "extract.system": T(
    "extract.system",
    "Instruction for structured extraction into a JSON schema.",
    `
Extract the requested fields from the text into JSON matching the schema exactly. Use null for any
field that is not explicitly present in the text. Never infer or fabricate amounts, dates or
identifiers. Amounts must be copied verbatim as decimal strings when the schema expects strings.
{{instructions}}
`,
  ),
  "verify.system": T(
    "verify.system",
    "Instruction for claim verification against evidence.",
    `
You are a verification auditor. Compare the claim against the evidence and the deterministic
number checks. Respond with JSON only:
{"verdict": "SUPPORTED"|"UNSUPPORTED"|"CONTRADICTED"|"INSUFFICIENT_EVIDENCE", "issues": [...], "confidence": <0..1>}.
CONTRADICTED when the evidence or a number check disagrees with the claim; UNSUPPORTED when the
evidence neither supports nor contradicts it; INSUFFICIENT_EVIDENCE when there is no usable evidence.
`,
  ),
  "verify.user": T(
    "verify.user",
    "User turn for verification: claim, evidence, number checks.",
    `
Claim:
{{claim}}

Evidence:
{{evidence}}

Number checks (claimed vs computed):
{{numbers}}
`,
  ),
  "json.instruction": T(
    "json.instruction",
    "Appended when a provider cannot enforce a JSON schema natively.",
    `
Respond with a single JSON object that conforms to this JSON schema and nothing else:
{{schema}}
`,
  ),
} as const satisfies Record<string, PromptTemplate>;

export type PromptName = keyof typeof PROMPT_TEMPLATES;

export function getPromptTemplate(name: PromptName): PromptTemplate {
  return PROMPT_TEMPLATES[name];
}

export function listPromptTemplates(): PromptTemplate[] {
  return Object.values(PROMPT_TEMPLATES);
}

/** Render a template, substituting `{{key}}` placeholders. */
export function renderPrompt(name: PromptName, vars: Record<string, string | number | null | undefined> = {}): string {
  const tpl = PROMPT_TEMPLATES[name].template;
  return tpl.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined ? match : v === null ? "" : String(v);
  });
}

/** Version tag to persist alongside audit events for a given template. */
export function promptVersionTag(name: PromptName): string {
  return `${PROMPT_VERSION}:${name}@${PROMPT_TEMPLATES[name].version}`;
}
