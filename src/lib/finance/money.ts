/**
 * Money primitives.
 *
 * All amounts are integer cents. An amount is either Known or Unknown. Unknown
 * values never silently become zero: sums carry the list of unknown items, and
 * callers must present "known so far" figures together with that list.
 */

export type Cents = number;

export type KnownAmount = { kind: "known"; cents: Cents };
export type UnknownAmount = { kind: "unknown"; reason: string };
export type Amount = KnownAmount | UnknownAmount;

export function known(cents: Cents): KnownAmount {
  if (!Number.isFinite(cents)) throw new Error("known() requires a finite number of cents");
  return { kind: "known", cents: Math.round(cents) };
}

export function unknown(reason: string): UnknownAmount {
  return { kind: "unknown", reason };
}

export function isKnown(a: Amount): a is KnownAmount {
  return a.kind === "known";
}

/** Convert a nullable cents value from storage into an Amount. */
export function amountFromNullable(cents: number | null | undefined, reasonIfNull: string): Amount {
  return cents === null || cents === undefined ? unknown(reasonIfNull) : known(cents);
}

/**
 * A total that may be partially unknown. `knownCents` is the sum of the known
 * parts; `unknowns` lists the reasons for every unknown part. `complete` is true
 * only when nothing was unknown.
 */
export interface Total {
  knownCents: Cents;
  unknowns: string[];
  complete: boolean;
}

export function total(knownCents: Cents, unknowns: string[] = []): Total {
  return { knownCents: Math.round(knownCents), unknowns: [...unknowns], complete: unknowns.length === 0 };
}

export function totalOf(amount: Amount): Total {
  return isKnown(amount) ? total(amount.cents) : total(0, [amount.reason]);
}

export function sumAmounts(amounts: Amount[]): Total {
  let cents = 0;
  const unknowns: string[] = [];
  for (const a of amounts) {
    if (isKnown(a)) cents += a.cents;
    else unknowns.push(a.reason);
  }
  return total(cents, unknowns);
}

export function addTotals(...totals: Total[]): Total {
  let cents = 0;
  const unknowns: string[] = [];
  for (const t of totals) {
    cents += t.knownCents;
    unknowns.push(...t.unknowns);
  }
  return total(cents, unknowns);
}

/** a - b, keeping unknowns from both sides. */
export function subtractTotals(a: Total, b: Total): Total {
  return total(a.knownCents - b.knownCents, [...a.unknowns, ...b.unknowns]);
}

export function negateTotal(t: Total): Total {
  return total(-t.knownCents, t.unknowns);
}

/** Multiply an amount by a rate expressed in percent. Unknown rate => unknown. */
export function percentOf(base: Amount, ratePct: number | null, unknownReason: string): Amount {
  if (ratePct === null || ratePct === undefined || !Number.isFinite(ratePct)) return unknown(unknownReason);
  if (!isKnown(base)) return unknown(base.reason);
  return known(Math.round((base.cents * ratePct) / 100));
}

export function percentOfTotal(base: Total, ratePct: number | null, unknownReason: string): Amount {
  if (ratePct === null || ratePct === undefined || !Number.isFinite(ratePct)) return unknown(unknownReason);
  if (!base.complete) return unknown(`${unknownReason} (base includes unknowns: ${base.unknowns.join("; ")})`);
  return known(Math.round((base.knownCents * ratePct) / 100));
}

export function totalToAmount(t: Total, unknownLabel = "depends on unknown items"): Amount {
  return t.complete ? known(t.knownCents) : unknown(`${unknownLabel}: ${t.unknowns.join("; ")}`);
}

export type Cadence = "weekly" | "monthly" | "quarterly" | "annual" | "one_time";

/** Normalize a recurring amount to its monthly equivalent. One-time items are not recurring. */
export function monthlyEquivalent(amount: Amount, cadence: Cadence): Amount {
  if (!isKnown(amount)) return amount;
  switch (cadence) {
    case "weekly":
      return known((amount.cents * 52) / 12);
    case "monthly":
      return amount;
    case "quarterly":
      return known(amount.cents / 3);
    case "annual":
      return known(amount.cents / 12);
    case "one_time":
      return known(0);
  }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function formatCents(cents: Cents, opts: { cents?: boolean; signed?: boolean } = {}): string {
  const dollars = cents / 100;
  const s = opts.cents ? usdCents.format(Math.abs(dollars)) : usd.format(Math.abs(dollars));
  if (cents < 0) return `−${s}`;
  if (opts.signed && cents > 0) return `+${s}`;
  return s;
}

export function formatAmount(a: Amount, opts: { cents?: boolean } = {}): string {
  return isKnown(a) ? formatCents(a.cents, opts) : "Unknown";
}

/**
 * Format a total honestly: a complete total is a plain figure; an incomplete one
 * is "$X known · N unknown".
 */
export function formatTotal(t: Total, opts: { cents?: boolean } = {}): string {
  if (t.complete) return formatCents(t.knownCents, opts);
  const n = t.unknowns.length;
  return `${formatCents(t.knownCents, opts)} known · ${n} unknown`;
}

export function dollarsToCents(dollars: number | string): Cents {
  const n = typeof dollars === "string" ? Number(dollars.replace(/[$,\s]/g, "")) : dollars;
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${dollars}`);
  return Math.round(n * 100);
}
