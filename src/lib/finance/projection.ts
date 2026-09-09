import { isKnown, sumAmounts, type Amount } from "./money";

export interface ProjectionFlow {
  label: string;
  amount: Amount;
}

export interface ProjectionEvent {
  /** 0 = first projected month. */
  monthOffset: number;
  /** Negative = cash out. */
  amountCents: number;
  label: string;
  /** Repeat every month from monthOffset for this many months (null = until the end). */
  repeatMonths?: number | null;
}

export interface ProjectionInput {
  startingCash: Amount;
  /** YYYY-MM of the first projected month. */
  startMonth: string;
  months: number;
  monthlyInflows: ProjectionFlow[];
  monthlyOutflows: ProjectionFlow[];
  events?: ProjectionEvent[];
}

export interface ProjectionMonth {
  month: string;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  /** null when starting cash is unknown. */
  endingCashCents: number | null;
}

export interface Projection {
  months: ProjectionMonth[];
  unknowns: string[];
  minCashCents: number | null;
  endingCashCents: number | null;
  firstNegativeMonth: string | null;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function project(input: ProjectionInput): Projection {
  const inflow = sumAmounts(input.monthlyInflows.map((f) => f.amount));
  const outflow = sumAmounts(input.monthlyOutflows.map((f) => f.amount));
  const unknowns = [...inflow.unknowns, ...outflow.unknowns];
  if (!isKnown(input.startingCash)) unknowns.push(input.startingCash.reason);

  let cash = isKnown(input.startingCash) ? input.startingCash.cents : null;
  const months: ProjectionMonth[] = [];
  let min: number | null = cash;
  let firstNegative: string | null = null;

  for (let i = 0; i < input.months; i++) {
    const month = addMonths(input.startMonth, i);
    let eventsIn = 0;
    let eventsOut = 0;
    for (const e of input.events ?? []) {
      const active = e.repeatMonths === undefined ? i === e.monthOffset : i >= e.monthOffset && (e.repeatMonths === null || i < e.monthOffset + e.repeatMonths);
      if (!active) continue;
      if (e.amountCents >= 0) eventsIn += e.amountCents;
      else eventsOut += -e.amountCents;
    }
    const inflowCents = inflow.knownCents + eventsIn;
    const outflowCents = outflow.knownCents + eventsOut;
    const netCents = inflowCents - outflowCents;
    if (cash !== null) {
      cash += netCents;
      if (min === null || cash < min) min = cash;
      if (cash < 0 && firstNegative === null) firstNegative = month;
    }
    months.push({ month, inflowCents, outflowCents, netCents, endingCashCents: cash });
  }

  return { months, unknowns, minCashCents: min, endingCashCents: cash, firstNegativeMonth: firstNegative };
}
