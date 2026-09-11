/**
 * Shared helpers for agent tools: result builders, proposed-action factory, journal-line
 * rendering and small dataset lookups. Keeps every tool file short and uniform.
 */
import type { Escalation, NewJournalEntryInput, NewJournalLineInput, ToolContext, ToolResult } from "@/lib/core/contracts";
import type { KeyFigure } from "@/lib/core/contracts";
import type { ActionKind, Assumption, CalcResult, DecimalString, ID, ISODate, Money, PeriodStatus, ProposedAction } from "@/lib/core/types";
import { nowISO } from "@/lib/core/dates";
import { newId } from "@/lib/core/ids";
import { D, add, eq, fmtMoney, money } from "@/lib/core/money";
import { findPeriod } from "@/lib/accounting/periods";
import { formatCalcValue } from "../response";
import type { Presentation, ToolData } from "../types";

export type Result = ToolResult<ToolData>;

export function ok(presentation: Presentation, extra: { calcs?: CalcResult[]; sourceIds?: ID[]; assumptions?: Assumption[]; proposedActions?: ProposedAction[]; data?: Record<string, unknown> } = {}): Result {
  const calcs = extra.calcs ?? [];
  const assumptions = [...(extra.assumptions ?? []), ...calcs.flatMap((c) => c.assumptions)];
  const sourceIds = [...new Set([...(extra.sourceIds ?? []), ...calcs.flatMap((c) => c.sourceIds)])];
  return { ok: true, data: { presentation, ...(extra.data ?? {}) }, calcs, sourceIds, assumptions, proposedActions: extra.proposedActions };
}

export function fail(error: string): Result {
  return { ok: false, error };
}

export function esc(type: Escalation["type"], message: string, extra: Partial<Escalation> = {}): Escalation {
  return { type, message, ...extra };
}

export function insufficient(missing: string[], answer: string, extra: Partial<Presentation> = {}): Presentation {
  return {
    answer,
    escalation: esc("INSUFFICIENT_INFORMATION", `Missing: ${missing.join("; ")}. Unknown values are never replaced with zero or a guess.`, { missingItems: missing }),
    confidence: 0.5,
    ...extra,
    structured: { value: null, missing, ...(extra.structured ?? {}) },
  };
}

export function figure(label: string, calc: CalcResult, note?: string): KeyFigure {
  return { label, value: formatCalcValue(calc), calcId: calc.id, note: note ?? (calc.value === null ? "INSUFFICIENT_INFORMATION" : undefined) };
}

export function moneyFigure(label: string, value: DecimalString | number | null | undefined, calcId?: ID, note?: string): KeyFigure {
  return { label, value: value === null || value === undefined || value === "" ? "UNKNOWN" : fmtMoney(D(value)), calcId, note };
}

export function textFigure(label: string, value: string | number | null | undefined, note?: string): KeyFigure {
  return { label, value: value === null || value === undefined ? "UNKNOWN" : String(value), note };
}

export interface ProposeInput {
  kind: ActionKind;
  description: string;
  reason: string;
  amount?: DecimalString | number | null;
  targetIds?: ID[];
  payload?: Record<string, unknown>;
  context?: ProposedAction["context"];
  confidence?: number;
  reversible?: boolean;
  rollbackPlan?: string;
  sourceDocumentIds?: ID[];
  financialImpact?: string;
  alternatives?: string[];
}

export function propose(ctx: ToolContext, input: ProposeInput): ProposedAction {
  const amount: Money | undefined = input.amount === null || input.amount === undefined ? undefined : { amount: money(input.amount), currency: ctx.dataset.profile.functionalCurrency };
  return {
    id: newId("pa"),
    kind: input.kind,
    agent: ctx.agent,
    description: input.description,
    amount,
    targetIds: input.targetIds ?? [],
    payload: input.payload ?? {},
    reason: input.reason,
    financialImpact: input.financialImpact,
    sourceDocumentIds: input.sourceDocumentIds ?? [],
    confidence: input.confidence ?? 0.8,
    alternatives: input.alternatives,
    reversible: input.reversible ?? true,
    rollbackPlan: input.rollbackPlan,
    createdAt: nowISO(),
    context: input.context,
  };
}

export interface StructuredLine {
  accountCode: string;
  accountName?: string;
  debit: DecimalString;
  credit: DecimalString;
  memo?: string;
}

export interface StructuredEntry {
  date: ISODate;
  description: string;
  source: string;
  lines: StructuredLine[];
  totalDebits: DecimalString;
  totalCredits: DecimalString;
  balanced: boolean;
  touchesRestrictedAccount: boolean;
  accountIds: ID[];
}

/** Render a NewJournalEntryInput for the structured payload and check that it balances. */
export function structuredEntry(ctx: ToolContext, entry: NewJournalEntryInput): StructuredEntry {
  const lines: StructuredLine[] = [];
  let debits = "0.0000";
  let credits = "0.0000";
  let restricted = false;
  const accountIds: ID[] = [];
  for (const l of entry.lines) {
    const acct = ctx.ledger.getAccount(l.accountId ?? l.accountCode ?? "");
    const debit = money(l.debit ?? 0);
    const credit = money(l.credit ?? 0);
    debits = add(debits, debit);
    credits = add(credits, credit);
    if (acct?.restricted) restricted = true;
    if (acct) accountIds.push(acct.id);
    lines.push({ accountCode: acct?.code ?? l.accountCode ?? l.accountId ?? "?", accountName: acct?.name, debit, credit, memo: l.memo });
  }
  return { date: entry.date, description: entry.description, source: entry.source, lines, totalDebits: debits, totalCredits: credits, balanced: eq(debits, credits) && lines.length >= 2, touchesRestrictedAccount: restricted, accountIds };
}

export function line(accountCode: string, side: "debit" | "credit", amount: DecimalString | number, memo?: string): NewJournalLineInput {
  return side === "debit" ? { accountCode, debit: money(amount), memo } : { accountCode, credit: money(amount), memo };
}

export function periodStatusAt(ctx: ToolContext, date: ISODate): PeriodStatus {
  return findPeriod(ctx.dataset, date)?.status ?? "OPEN";
}

export function accountCode(ctx: ToolContext, accountId: ID | null | undefined): string | null {
  if (!accountId) return null;
  return ctx.ledger.getAccount(accountId)?.code ?? null;
}

export function accountName(ctx: ToolContext, idOrCode: string | null | undefined): string {
  if (!idOrCode) return "(unknown account)";
  const a = ctx.ledger.getAccount(idOrCode);
  return a ? `${a.code} ${a.name}` : idOrCode;
}

export const toDec = (v: string | number | null | undefined): DecimalString | null => (v === null || v === undefined || v === "" ? null : money(v));

export function monthsBefore(asOf: ISODate, n: number): string[] {
  const out: string[] = [];
  let y = Number(asOf.slice(0, 4));
  let m = Number(asOf.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export const pct = (v: number | null | undefined, dp = 1): string => (v === null || v === undefined || !Number.isFinite(v) ? "UNKNOWN" : `${(v * 100).toFixed(dp)}%`);
