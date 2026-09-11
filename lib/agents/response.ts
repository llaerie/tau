/**
 * Executive response composer. Produces the mandatory format
 *   ANSWER / NUMBERS / WHY / WHAT CHANGES / RISKS / RECOMMENDATION / NEEDS APPROVAL / SOURCE & ASSUMPTIONS
 * purely from deterministic inputs: tool presentations, CalcResults, assumptions and source refs.
 * No number is ever invented here; key figures are copied from calc values or given by tools.
 */
import type { Escalation, ExecutiveResponse, HighRiskBreakdown, KeyFigure, SourceRef } from "@/lib/core/contracts";
import type { AgentAction, Assumption, CalcResult, ID, ProposedAction, RiskLevel, Role } from "@/lib/core/types";
import { D, fmtMoney, fmtPercent } from "@/lib/core/money";
import { educationFor, type EducationConceptKey } from "@/lib/knowledge/education";
import type { Presentation } from "./types";

export const RESPONSE_SECTIONS = ["ANSWER", "NUMBERS", "WHY", "WHAT CHANGES", "RISKS", "RECOMMENDATION", "NEEDS APPROVAL", "SOURCE & ASSUMPTIONS"] as const;

/** Render a calc value for display without changing it. */
export function formatCalcValue(calc: CalcResult): string {
  const v = calc.value;
  if (v === null || v === undefined) return "UNKNOWN";
  switch (calc.unit) {
    case "USD":
    case "CURRENCY":
      return typeof v === "string" || typeof v === "number" ? fmtMoney(v) : JSON.stringify(v);
    case "PERCENT":
    case "RATIO":
      return typeof v === "number" ? (calc.unit === "PERCENT" ? fmtPercent(v, 2) : v.toFixed(4)) : String(v);
    case "MONTHS":
    case "WEEKS":
    case "DAYS":
    case "COUNT":
      return typeof v === "number" ? `${Number.isInteger(v) ? v : v.toFixed(2)} ${calc.unit.toLowerCase()}` : String(v);
    default:
      return typeof v === "object" ? "(see structured)" : String(v);
  }
}

/** Key figures derived from scalar CalcResults (objects/tables are skipped; tools present those explicitly). */
export function keyFiguresFromCalcs(calcs: CalcResult[]): KeyFigure[] {
  const out: KeyFigure[] = [];
  for (const c of calcs) {
    if (c.value !== null && typeof c.value === "object") continue;
    out.push({ label: c.name.replace(/_/g, " "), value: formatCalcValue(c), calcId: c.id, note: c.value === null ? (c.notes?.[0] ?? "INSUFFICIENT_INFORMATION") : undefined });
  }
  return out;
}

export function fmtDec(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "UNKNOWN";
  try {
    return fmtMoney(D(v));
  } catch {
    return String(v);
  }
}

/** Human-readable source & assumption lines. Deduplicated, stable order. */
export function sourcesAndAssumptionsLines(calcs: CalcResult[], assumptions: Assumption[], sources: SourceRef[], extra: string[] = []): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!seen.has(s)) {
      seen.add(s);
      lines.push(s);
    }
  };
  for (const c of calcs) {
    push(`Calculation ${c.name} [${c.id}]: ${c.formula}${c.sourceIds.length ? ` — sources: ${c.sourceIds.slice(0, 6).join(", ")}${c.sourceIds.length > 6 ? ` (+${c.sourceIds.length - 6})` : ""}` : ""}`);
    for (const n of c.notes ?? []) push(`Note (${c.name}): ${n}`);
  }
  for (const a of assumptions) {
    const v = a.value === null || a.value === undefined ? "UNKNOWN" : typeof a.value === "object" ? JSON.stringify(a.value) : String(a.value);
    push(`Assumption [${a.status}] ${a.key}: ${a.description} (value: ${v})${a.requiresProfessionalReview ? " — professional review required" : ""}`);
  }
  for (const s of sources) push(`Source (${s.kind}${s.status ? `, ${s.status}` : ""}) ${s.label} [${s.id}]`);
  for (const e of extra) push(e);
  return lines;
}

export interface ComposeInput {
  presentation: Presentation;
  calcs: CalcResult[];
  assumptions: Assumption[];
  sources: SourceRef[];
  needsApproval: ExecutiveResponse["needsApproval"];
  escalation?: Escalation;
  highRisk?: HighRiskBreakdown;
  /** Extra source lines (e.g. policy citations). */
  extraSourceLines?: string[];
  agentActions?: AgentAction[];
}

export function composeExecutiveResponse(input: ComposeInput): ExecutiveResponse {
  const p = input.presentation;
  const numbers = p.numbers && p.numbers.length ? p.numbers : keyFiguresFromCalcs(input.calcs);
  const risks = [...(p.risks ?? [])];
  if (input.escalation) risks.unshift(`${input.escalation.type}: ${input.escalation.message}`);
  const whatChanges = [...(p.whatChanges ?? [])];
  for (const a of input.agentActions ?? []) {
    whatChanges.push(`${a.action.kind} → ${a.status}${a.blockedReason ? ` (${a.blockedReason})` : ""}: ${a.action.description}`);
  }
  if (!whatChanges.length) whatChanges.push("No records were changed by this request.");
  const education = p.educationKey ? educationFor(p.educationKey) : undefined;
  const resp: ExecutiveResponse = {
    answer: p.answer,
    numbers,
    why: p.why && p.why.length ? p.why : ["Figures come from the deterministic calculation engine and the ledger; see SOURCE & ASSUMPTIONS."],
    whatChanges,
    risks,
    recommendation: p.recommendation ?? defaultRecommendation(input.escalation, input.needsApproval.length),
    needsApproval: input.needsApproval,
    sourcesAndAssumptions: sourcesAndAssumptionsLines(input.calcs, input.assumptions, input.sources, input.extraSourceLines),
  };
  if (education) resp.education = { title: education.title, text: education.whyItMatters };
  if (input.highRisk) resp.highRisk = input.highRisk;
  return resp;
}

function defaultRecommendation(escalation: Escalation | undefined, approvals: number): string {
  if (escalation) {
    switch (escalation.type) {
      case "INSUFFICIENT_INFORMATION":
        return `Provide the missing information${escalation.missingItems?.length ? ` (${escalation.missingItems.join("; ")})` : ""} and I will complete the calculation. Nothing has been assumed.`;
      case "CPA_REVIEW_REQUIRED":
        return "Route this to the CPA with the prepared facts and calculations; do not act on it until the CPA confirms the treatment.";
      case "PROFESSIONAL_REVIEW_REQUIRED":
        return "A licensed professional must decide this. I have prepared the facts and open questions for that review.";
      case "APPROVAL_REQUIRED":
        return "Review the proposed action and approve or reject it; nothing has been executed.";
      case "REFUSED_CONTROL_VIOLATION":
        return "Use the compliant alternative described above; the requested action was not performed.";
      case "CANNOT_CLASSIFY":
        return "Provide the business purpose or counterparty so the transaction can be categorized; it stays in the exception queue until then.";
      case "OUT_OF_SCOPE":
        return "Ask a finance, accounting, cash, tax-operations or planning question, or submit a structured task.";
    }
  }
  return approvals > 0 ? "Review the pending approval request(s) below." : "No action is required from you right now.";
}

/** Render the response as the mandatory eight-section text. */
export function formatExecutiveResponse(r: ExecutiveResponse): string {
  const block = (title: string, lines: string[]) => `${title}\n${lines.length ? lines.map((l) => `- ${l}`).join("\n") : "- (none)"}`;
  const parts = [
    `ANSWER\n${r.answer}`,
    block("NUMBERS", r.numbers.map((n) => `${n.label}: ${n.value}${n.calcId ? ` [${n.calcId}]` : ""}${n.note ? ` — ${n.note}` : ""}`)),
    block("WHY", r.why),
    block("WHAT CHANGES", r.whatChanges),
    block("RISKS", r.risks),
    `RECOMMENDATION\n${r.recommendation}`,
    block("NEEDS APPROVAL", r.needsApproval.map((a) => `${a.riskLevel} ${a.description} → ${a.approverRoles.join(", ") || "none"} [${a.actionId}]`)),
    block("SOURCE & ASSUMPTIONS", r.sourcesAndAssumptions),
  ];
  if (r.highRisk) {
    parts.push(block("FACTS", r.highRisk.facts), block("CALCULATIONS", r.highRisk.calculations), block("ASSUMPTIONS", r.highRisk.assumptions), block("PROFESSIONAL JUDGMENT", r.highRisk.professionalJudgment));
  }
  if (r.education) parts.push(`WHY THIS MATTERS — ${r.education.title}\n${r.education.text}`);
  return parts.join("\n\n");
}

/** Build a default FACT / CALCULATION / ASSUMPTION / PROFESSIONAL JUDGMENT breakdown from deterministic parts. */
export function defaultHighRiskBreakdown(input: { numbers: KeyFigure[]; calcs: CalcResult[]; assumptions: Assumption[]; escalation?: Escalation; judgment?: string[]; facts?: string[] }): HighRiskBreakdown {
  const facts = [...(input.facts ?? [])];
  for (const n of input.numbers) if (!n.calcId) facts.push(`${n.label}: ${n.value}`);
  const calculations = input.calcs.map((c) => `${c.name} = ${formatCalcValue(c)} [${c.id}] via ${c.formula}`);
  const assumptions = input.assumptions.map((a) => `[${a.status}] ${a.key}: ${a.description}`);
  const judgment = [...(input.judgment ?? [])];
  if (input.escalation) judgment.push(`${input.escalation.type}: ${input.escalation.message}`);
  if (!judgment.length) judgment.push("Treatment, deductibility and compliance conclusions on this topic require CPA / professional judgment; the system provides facts and calculations only.");
  return { facts: facts.length ? facts : ["No additional facts beyond the calculations listed."], calculations: calculations.length ? calculations : ["No calculations were performed."], assumptions: assumptions.length ? assumptions : ["No assumptions were required."], professionalJudgment: judgment };
}

export function needsApprovalEntry(action: ProposedAction, level: RiskLevel, roles: Role[]): ExecutiveResponse["needsApproval"][number] {
  return { actionId: action.id, description: action.description, approverRoles: roles, riskLevel: level };
}

export function sourceRef(id: ID, kind: SourceRef["kind"], label: string, status?: string): SourceRef {
  return { id, kind, label, status };
}

export function educationKeyForTask(kind: string): EducationConceptKey | undefined {
  const map: Record<string, EducationConceptKey> = {
    "cash.runway": "cash_runway",
    "cash.thirteen_week": "thirteen_week_cash",
    "cash.working_capital": "working_capital",
    "cash.position": "cash_vs_profit",
    "cash.reserve_coverage": "cash_runway",
    "accounting.prepaid_amortization": "prepaid_amortization",
    "accounting.depreciation_schedule": "depreciation",
    "accounting.accrual": "accrual_basis",
    "accounting.close_period": "period_lock",
    "accounting.modify_closed_period": "period_lock",
    "fpa.budget_variance": "budget_variance",
    "fpa.forecast_variance": "budget_variance",
    "strategy.npv": "npv",
    "strategy.investment_case": "npv",
    "strategy.break_even": "break_even",
    "strategy.contribution_margin": "contribution_margin",
    "ar.aging": "ar_aging",
    "ar.collection_reminder": "ar_aging",
    "payroll.liabilities": "payroll_liabilities",
    "payroll.gross_to_net": "gross_vs_net",
    "payroll.owner_compensation": "reasonable_compensation",
    "tax.shareholder_summary": "owner_salary_vs_distribution",
    "tax.calendar": "estimated_taxes",
    "controls.personal_business_check": "personal_business_separation",
    "accounting.classify_transaction": "personal_business_separation",
  };
  return map[kind];
}
