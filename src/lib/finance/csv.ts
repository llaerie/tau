import Papa from "papaparse";
import { dollarsToCents } from "./money";

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export interface ColumnMapping {
  date: number;
  description: number;
  /** Single signed amount column, or null when debit/credit columns are used. */
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** When true, positive amounts in the amount column mean money out (some banks export this way). */
  invertSign: boolean;
}

export interface ImportedRow {
  rowNumber: number;
  date: string;
  description: string;
  /** Signed cents: positive = money in, negative = money out. */
  amountCents: number;
  /** Stable hash of date + amount + description for de-duplication. */
  hash: string;
  error?: string;
}

export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const [headers = [], ...rows] = result.data;
  return { headers: headers.map((h) => h.trim()), rows };
}

const DATE_KEYS = ["date", "posted", "transaction date", "posting date"];
const DESC_KEYS = ["description", "memo", "payee", "name", "details", "narrative"];
const AMOUNT_KEYS = ["amount", "value"];
const DEBIT_KEYS = ["debit", "withdrawal", "money out", "out"];
const CREDIT_KEYS = ["credit", "deposit", "money in", "in"];

function findColumn(headers: string[], keys: string[]): number | null {
  const lower = headers.map((h) => h.toLowerCase());
  for (const k of keys) {
    const exact = lower.indexOf(k);
    if (exact >= 0) return exact;
  }
  for (const k of keys) {
    const partial = lower.findIndex((h) => h.includes(k));
    if (partial >= 0) return partial;
  }
  return null;
}

export function detectMapping(headers: string[]): ColumnMapping {
  const date = findColumn(headers, DATE_KEYS) ?? 0;
  const description = findColumn(headers, DESC_KEYS) ?? 1;
  const amount = findColumn(headers, AMOUNT_KEYS);
  const debit = findColumn(headers, DEBIT_KEYS);
  const credit = findColumn(headers, CREDIT_KEYS);
  return { date, description, amount: amount !== null ? amount : null, debit: amount === null ? debit : null, credit: amount === null ? credit : null, invertSign: false };
}

export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}

export function parseSignedCents(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-") || s.startsWith("−");
  const cleaned = s.replace(/[()$,\s−-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

export function hashRow(date: string, amountCents: number, description: string): string {
  const input = `${date}|${amountCents}|${description.trim().toLowerCase()}`;
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  let h2 = 52711;
  for (let i = input.length - 1; i >= 0; i--) h2 = ((h2 << 5) + h2 + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function mapRows(table: CsvTable, mapping: ColumnMapping): ImportedRow[] {
  return table.rows.map((cells, i) => {
    const rowNumber = i + 2;
    const date = normalizeDate(cells[mapping.date] ?? "");
    const description = (cells[mapping.description] ?? "").trim();
    let amountCents: number | null = null;
    if (mapping.amount !== null) {
      amountCents = parseSignedCents(cells[mapping.amount] ?? "");
      if (amountCents !== null && mapping.invertSign) amountCents = -amountCents;
    } else {
      const debit = mapping.debit !== null ? parseSignedCents(cells[mapping.debit] ?? "") : null;
      const credit = mapping.credit !== null ? parseSignedCents(cells[mapping.credit] ?? "") : null;
      if (debit !== null && debit !== 0) amountCents = -Math.abs(debit);
      else if (credit !== null) amountCents = Math.abs(credit);
    }
    const errors: string[] = [];
    if (!date) errors.push("unrecognized date");
    if (amountCents === null) errors.push("missing amount");
    if (!description) errors.push("missing description");
    return {
      rowNumber,
      date: date ?? "",
      description,
      amountCents: amountCents ?? 0,
      hash: hashRow(date ?? "", amountCents ?? 0, description),
      error: errors.length ? errors.join(", ") : undefined,
    };
  });
}

export { dollarsToCents };
