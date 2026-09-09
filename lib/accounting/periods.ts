/**
 * Accounting period helpers. Periods are calendar months identified as "YYYY-MM".
 */
import { monthEnd, monthOf, monthStart, nowISO, yearOf } from "@/lib/core/dates";
import { PeriodLockedError } from "@/lib/core/errors";
import type { CompanyDataset, ISODate, JournalSource, Period, PeriodStatus } from "@/lib/core/types";

/**
 * `Period` carries no free-form history field, so lock/unlock events are recorded on an
 * additive `tags` property that survives JSON persistence without changing the contract.
 */
export type PeriodWithTags = Period & { tags?: string[] };

/** Journal sources that may still post into a SOFT_CLOSED period. */
export const SOFT_CLOSE_ALLOWED_SOURCES: ReadonlySet<JournalSource> = new Set<JournalSource>([
  "ADJUSTING",
  "CLOSING",
  "CORRECTING",
  "REVERSAL",
]);

export function periodIdFor(date: ISODate): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid ISO date for period: ${date}`);
  return date.slice(0, 7);
}

export function buildPeriod(date: ISODate): Period {
  return {
    id: periodIdFor(date),
    year: yearOf(date),
    month: monthOf(date),
    startDate: monthStart(date),
    endDate: monthEnd(date),
    status: "OPEN",
  };
}

export function findPeriod(dataset: CompanyDataset, date: ISODate): Period | undefined {
  const id = periodIdFor(date);
  return dataset.periods.find((p) => p.id === id);
}

export function findPeriodById(dataset: CompanyDataset, periodId: string): Period | undefined {
  return dataset.periods.find((p) => p.id === periodId);
}

/** Return the period for the date, creating an OPEN one if missing (kept sorted by id). */
export function ensurePeriod(dataset: CompanyDataset, date: ISODate, onCreate?: (p: Period) => void): Period {
  const existing = findPeriod(dataset, date);
  if (existing) return existing;
  const period = buildPeriod(date);
  dataset.periods.push(period);
  dataset.periods.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  onCreate?.(period);
  return period;
}

/** Whether an entry of `source` may be created/posted into a period of `status`. */
export function isWritable(status: PeriodStatus, source: JournalSource): boolean {
  if (status === "LOCKED") return false;
  if (status === "SOFT_CLOSED") return SOFT_CLOSE_ALLOWED_SOURCES.has(source);
  return true;
}

/** Throw `PeriodLockedError` when the period does not accept the given source. */
export function assertWritable(period: Period, source: JournalSource, what = "post"): void {
  if (isWritable(period.status, source)) return;
  throw new PeriodLockedError(`Cannot ${what} into period ${period.id}: period is ${period.status} (source ${source})`, {
    periodId: period.id,
    status: period.status,
    source,
  });
}

export function periodTag(period: Period, tag: string): void {
  const p = period as PeriodWithTags;
  p.tags = [...(p.tags ?? []), tag];
}

export function periodTags(period: Period): string[] {
  return [...((period as PeriodWithTags).tags ?? [])];
}

export function lockTagAt(actorId: string, approvalId: string, at: string = nowISO()): string {
  return `locked:${at}:${actorId}:${approvalId}`;
}

export function unlockTagAt(actorId: string, approvalId: string, reason: string, at: string = nowISO()): string {
  return `unlocked:${at}:${actorId}:${approvalId}:${reason}`;
}

/** Fiscal year boundaries. The lab company uses a calendar fiscal year. */
export function fiscalYearStart(date: ISODate): ISODate {
  return `${date.slice(0, 4)}-01-01`;
}
export function fiscalYearEnd(date: ISODate): ISODate {
  return `${date.slice(0, 4)}-12-31`;
}
