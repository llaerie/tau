/**
 * Shared specialist scaffolding: a `Specialist` class built from a declarative spec, plus small
 * NL helpers (expense-account hints, labelled amounts) used by the routers.
 */
import type { AgentName, DecimalString, ISODate } from "@/lib/core/types";
import { ACCT } from "@/lib/accounting/chart-of-accounts";
import { money } from "@/lib/core/money";
import { BaseAgent, type TaskHandler } from "../base-agent";
import { routeByRules, type RouteRule } from "../intent";
import type { TaskKind } from "../task-catalog";
import type { AgentTool, RouterResult } from "../types";

export interface SpecialistSpec {
  name: AgentName;
  description: string;
  keywords: RegExp[];
  rules: RouteRule[];
  /** [tool, ...task kinds it serves] */
  tools: [AgentTool, ...TaskKind[]][];
  handlers?: Partial<Record<TaskKind, TaskHandler>>;
}

export class Specialist extends BaseAgent {
  readonly name: AgentName;
  readonly description: string;
  protected readonly keywords: RegExp[];
  private readonly rules: RouteRule[];

  constructor(spec: SpecialistSpec) {
    super();
    this.name = spec.name;
    this.description = spec.description;
    this.keywords = spec.keywords;
    this.rules = spec.rules;
    for (const [tool, ...kinds] of spec.tools) this.registerTool(tool, ...kinds);
    for (const [kind, handler] of Object.entries(spec.handlers ?? {})) if (handler) this.registerHandler(kind as TaskKind, handler);
  }

  protected route(message: string, asOf?: ISODate): RouterResult | null {
    return routeByRules(this.rules, message, asOf);
  }
}

const ACCOUNT_HINTS: [RegExp, string][] = [
  [/\b(legal|attorney|lawyer|law firm|accounting fees?|cpa|bookkeep|audit fee|professional (fees?|services))\b/i, ACCT.PROFESSIONAL_FEES],
  [/\b(aws|cloud (compute|hosting)|gcp|azure|compute)\b/i, ACCT.COGS_CLOUD],
  [/\b(openai|anthropic|api usage|model usage|llm)\b/i, ACCT.COGS_AI_API],
  [/\b(software|subscription|saas|github|notion|slack|zoom|adobe|figma)\b/i, ACCT.SOFTWARE],
  [/\b(rent|coworking|office space|lease)\b/i, ACCT.RENT],
  [/\b(insurance)\b/i, ACCT.INSURANCE],
  [/\b(meal|lunch|dinner|restaurant|coffee)\b/i, ACCT.MEALS],
  [/\b(travel|flight|hotel|airfare|uber|lyft)\b/i, ACCT.TRAVEL],
  [/\b(marketing|advertis|ads)\b/i, ACCT.MARKETING],
  [/\b(office supplies|supplies|amazon)\b/i, ACCT.OFFICE_SUPPLIES],
  [/\b(phone|mobile|telecom)\b/i, ACCT.TELECOM],
  [/\b(internet|utilit|electric)\b/i, ACCT.UTILITIES],
  [/\b(bank fee|wire fee|merchant fee)\b/i, ACCT.BANK_FEES],
  [/\b(training|course|conference|education)\b/i, ACCT.EDUCATION],
  [/\b(license|permit|filing fee)\b/i, ACCT.LICENSES],
  [/\b(contractor|freelanc)\b/i, ACCT.CONTRACTORS_DOMESTIC],
  [/\b(salar|wages|payroll)\b/i, ACCT.SALARIES],
  [/\b(interest)\b/i, ACCT.INTEREST_EXPENSE],
  [/\b(depreciation)\b/i, ACCT.DEPRECIATION],
  [/\b(franchise tax)\b/i, ACCT.STATE_TAXES],
];

/** Guess an expense account code from words in the message (explicit 4-digit codes win). */
export function guessExpenseCode(message: string, explicit?: string[]): string | undefined {
  const code = explicit?.find((c) => /^(5|6|7)\d{3}$/.test(c));
  if (code) return code;
  return ACCOUNT_HINTS.find(([re]) => re.test(message))?.[1];
}

/** Amount that appears near a label ("fixed costs are $50,000", "price $200"). */
export function labelledAmount(message: string, label: RegExp): DecimalString | undefined {
  const re = new RegExp(`${label.source}[^$\\d]{0,25}\\$?\\s?(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s?(k|m)?\\b`, "i");
  const m = re.exec(message);
  if (!m) return undefined;
  let n = Number(m[1].replace(/,/g, ""));
  if ((m[2] ?? "").toLowerCase() === "k") n *= 1000;
  if ((m[2] ?? "").toLowerCase() === "m") n *= 1_000_000;
  return Number.isFinite(n) ? money(n) : undefined;
}

/** Name following "from"/"to"/"for" ("bill from Law LLP for $1,200"). */
export function nameAfter(message: string, prep: RegExp): string | undefined {
  const re = new RegExp(`\\b${prep.source}\\s+([A-Z][\\w&'.-]*(?:\\s+[A-Z][\\w&'.-]*){0,4})`, "");
  const m = re.exec(message);
  return m?.[1]?.trim();
}

export function previousMonth(asOf: ISODate): string {
  let y = Number(asOf.slice(0, 4));
  let m = Number(asOf.slice(5, 7)) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}
