import type { Amount, Cadence, Total } from "./money";

export type SpaceKind = "company" | "household" | "personal";

/** Every primary metric carries the story of where its number came from. */
export interface ProvenanceInput {
  label: string;
  value: string;
  /** Where the input lives: "Settings → Company → Anticipated revenue", "Ledger: 12 transactions", ... */
  source: string;
}

export interface Provenance {
  formula: string;
  inputs: ProvenanceInput[];
  assumptions: string[];
  caveats: string[];
}

export interface Metric {
  id: string;
  label: string;
  total: Total;
  provenance: Provenance;
}

export type WaterfallLineKind = "inflow" | "outflow" | "reserve" | "subtotal" | "result";

export interface WaterfallLine {
  id: string;
  label: string;
  kind: WaterfallLineKind;
  amount: Amount;
  /** Running total after this line. */
  running: Total;
  source: string;
  note?: string;
}

export interface BillInput {
  id: string;
  name: string;
  amount: Amount;
  cadence: Cadence;
  /** Day of month the bill is due (1-31) when known. */
  dueDay?: number | null;
  /** True when a payment transaction for the current period already exists. */
  paidThisPeriod?: boolean;
}

export interface GoalInput {
  id: string;
  name: string;
  /** Monthly contribution wanted for this goal. */
  monthlyTarget: Amount;
  /** 1 = highest priority. */
  priority: number;
  /** Optional total target (e.g. an emergency fund). */
  targetTotalCents?: number | null;
  /** Amount already saved toward the goal. */
  savedCents?: number;
  /** Ordering rule this goal enforces, e.g. "funded before discretionary spending". */
  rule?: string;
}

export interface GoalAllocation {
  goalId: string;
  name: string;
  priority: number;
  wantedCents: number;
  fundedCents: number;
  shortfallCents: number;
  /** Months until the goal reaches its target at the funded rate; null when no target or never. */
  monthsToTarget: number | null;
  /** True if any input for this goal was unknown. */
  hasUnknowns: boolean;
  rule?: string;
}

export interface GoalFundingResult {
  allocations: GoalAllocation[];
  totalWantedCents: number;
  totalFundedCents: number;
  totalShortfallCents: number;
  remainingCents: number;
}
