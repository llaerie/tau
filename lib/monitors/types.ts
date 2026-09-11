/**
 * Proactive monitor contracts.
 *
 * A monitor is a deterministic, side-effect-free function over a `MonitorContext` that returns
 * `AttentionItem`s. Monitors never post, never move money and never guess: when a policy value
 * is unknown (e.g. the cash reserve) they emit an INFO item saying so instead of assuming one.
 */
import type { LedgerEngine, MaterialityThresholds } from "@/lib/core/contracts";
import type { CalcResult, CompanyDataset, ConfigField, DecimalString, ID, ISODate, ISODateTime, Policy } from "@/lib/core/types";
import type { TaxRuleStore } from "@/lib/tax/rule-store";

export type AttentionSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface AttentionItem {
  id: ID;
  kind: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  amount?: DecimalString;
  dueDate?: ISODate;
  relatedIds: ID[];
  suggestedTask?: { kind: string; params?: Record<string, unknown> };
  calcIds: ID[];
  sourceIds: ID[];
  createdAt: ISODateTime;
}

export interface MonitorContext {
  dataset: CompanyDataset;
  ledger: LedgerEngine;
  thresholds: MaterialityThresholds;
  /** The real company's finance bible (unknowns explicit). */
  bible: ConfigField[];
  policies: Policy[];
  taxRules: TaxRuleStore;
  asOf: ISODate;
  /** Register a deterministic calculation produced by a monitor; returns its id. */
  recordCalc(calc: CalcResult): ID;
  /** Every calculation recorded so far (read-only view). */
  readonly calcs: readonly CalcResult[];
}

export interface Monitor {
  key: string;
  description: string;
  run(ctx: MonitorContext): AttentionItem[];
}

export interface MonitorRunResult {
  asOf: ISODate;
  items: AttentionItem[];
  calcs: CalcResult[];
  monitors: { key: string; itemCount: number; error?: string }[];
}

export const SEVERITY_RANK: Readonly<Record<AttentionSeverity, number>> = Object.freeze({ CRITICAL: 3, WARNING: 2, INFO: 1 });
