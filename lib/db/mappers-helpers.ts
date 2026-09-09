/**
 * Scalar mapping helpers shared by every mapper module.
 *
 *  - Decimals are exact: DecimalString ↔ Prisma.Decimal via `money()` / `.toFixed(4)`. Never parseFloat.
 *  - ISODate ↔ DATE (UTC midnight); ISODateTime ↔ TIMESTAMPTZ(3) (normalized to `toISOString()`).
 *  - Optional domain fields are `undefined` in memory and NULL in the database; `compact()` strips
 *    undefined keys so a loaded entity deep-equals the entity that was written.
 *  - Optional *array* fields (tags, notes, sourceIds) always load as arrays (`[]` when empty), which
 *    is how the engines produce them; write `[]` rather than omitting them for exact round-trips.
 */
import { Prisma } from "@prisma/client";
import type * as PC from "@prisma/client";
import { money } from "@/lib/core/money";
import type { DecimalString, EntityRef, ISODate, ISODateTime } from "@/lib/core/types";

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

/** Prisma.Decimal → canonical 4-dp DecimalString. Exact; no binary floating point involved. */
export function decimalToString(d: Prisma.Decimal): DecimalString {
  return d.toFixed(4);
}
export function decimalToStringOpt(d: Prisma.Decimal | null | undefined): DecimalString | undefined {
  return d === null || d === undefined ? undefined : decimalToString(d);
}
/** DecimalString → Prisma.Decimal (validated and canonicalized to 4 dp). */
export function stringToDecimal(s: DecimalString | number): Prisma.Decimal {
  return new Prisma.Decimal(money(s));
}
export function stringToDecimalOpt(s: DecimalString | number | null | undefined): Prisma.Decimal | null {
  return s === null || s === undefined ? null : stringToDecimal(s);
}

/** DATE column (UTC midnight) → YYYY-MM-DD */
export function dateToISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}
export function dateToISOOpt(d: Date | null | undefined): ISODate | undefined {
  return d === null || d === undefined ? undefined : dateToISO(d);
}
/** YYYY-MM-DD → Date at UTC midnight (DATE column). */
export function isoToDate(s: ISODate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) throw new Error(`Invalid ISO date: "${s}"`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO date: "${s}"`);
  return d;
}
export function isoToDateOpt(s: ISODate | null | undefined): Date | null {
  return s === null || s === undefined ? null : isoToDate(s);
}

/** TIMESTAMPTZ → ISO 8601 (always `YYYY-MM-DDTHH:mm:ss.sssZ`). */
export function dateTimeToISO(d: Date): ISODateTime {
  return d.toISOString();
}
export function dateTimeToISOOpt(d: Date | null | undefined): ISODateTime | undefined {
  return d === null || d === undefined ? undefined : dateTimeToISO(d);
}
export function isoToDateTime(s: ISODateTime): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO date-time: "${s}"`);
  return d;
}
export function isoToDateTimeOpt(s: ISODateTime | null | undefined): Date | null {
  return s === null || s === undefined ? null : isoToDateTime(s);
}

/** Remove keys whose value is `undefined` so loaded entities deep-equal their source. */
export function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export const nullable = <T>(v: T | undefined): T | null => (v === undefined ? null : v);
export const optional = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

/** Required JSON column. */
export function toJson(v: unknown): Prisma.InputJsonValue {
  return (v === undefined ? null : v) as Prisma.InputJsonValue;
}
/** Optional JSON column: undefined → SQL NULL. */
export function toJsonOpt(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
}
export function fromJson<T>(v: Prisma.JsonValue): T {
  return v as unknown as T;
}
export function fromJsonOpt<T>(v: Prisma.JsonValue | null): T | undefined {
  return v === null ? undefined : (v as unknown as T);
}

export function entityRefFromRow(type: PC.$Enums.EntityRefType | null, id: string | null): EntityRef | undefined {
  return type && id ? { type, id } : undefined;
}
