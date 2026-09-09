/** Date helpers. All dates are ISO strings (YYYY-MM-DD) treated as UTC calendar dates. */
import type { ISODate, ISODateTime } from "./types";

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
export function parseISODate(s: ISODate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new Error(`Invalid ISO date: ${s}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISODate(s);
  return toISODate(d) === s;
}
export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISODate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}
export function addMonths(s: ISODate, months: number): ISODate {
  const d = parseISODate(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = daysInMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
  d.setUTCDate(Math.min(day, last));
  return toISODate(d);
}
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}
export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}
export function monthStart(s: ISODate): ISODate {
  return `${s.slice(0, 7)}-01`;
}
export function monthEnd(s: ISODate): ISODate {
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  return `${s.slice(0, 7)}-${pad2(daysInMonth(y, m))}`;
}
export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let cur = `${fromMonth}-01`;
  const end = `${toMonth}-01`;
  while (cur <= end) {
    out.push(cur.slice(0, 7));
    cur = addMonths(cur, 1);
  }
  return out;
}
export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function isWeekend(s: ISODate): boolean {
  const d = parseISODate(s).getUTCDay();
  return d === 0 || d === 6;
}
export function nextBusinessDay(s: ISODate): ISODate {
  let cur = s;
  while (isWeekend(cur)) cur = addDays(cur, 1);
  return cur;
}
export function previousBusinessDay(s: ISODate): ISODate {
  let cur = s;
  while (isWeekend(cur)) cur = addDays(cur, -1);
  return cur;
}
export function weekStart(s: ISODate): ISODate {
  const d = parseISODate(s);
  const dow = d.getUTCDay(); // 0 Sunday
  const diff = (dow + 6) % 7; // Monday-based
  d.setUTCDate(d.getUTCDate() - diff);
  return toISODate(d);
}
export function nowISO(): ISODateTime {
  return new Date().toISOString();
}
export function yearOf(s: ISODate): number {
  return Number(s.slice(0, 4));
}
export function monthOf(s: ISODate): number {
  return Number(s.slice(5, 7));
}
export function quarterOf(s: ISODate): number {
  return Math.floor((monthOf(s) - 1) / 3) + 1;
}
export function fmtDate(s: ISODate | null | undefined): string {
  if (!s) return "—";
  const d = parseISODate(s);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
