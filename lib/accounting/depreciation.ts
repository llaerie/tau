/**
 * Straight-line book depreciation. Monthly amounts are allocated with `allocate` so the schedule
 * sums exactly to cost − salvage with no rounding leakage.
 */
import { addMonths, monthEnd, monthKey } from "@/lib/core/dates";
import { D, allocate, money, sub } from "@/lib/core/money";
import type { NewJournalEntryInput, NewJournalLineInput } from "@/lib/core/contracts";
import type { DecimalString, FixedAsset, ID } from "@/lib/core/types";
import type { Ledger } from "./ledger";

export interface DepreciationRow {
  /** YYYY-MM */
  month: string;
  amount: DecimalString;
  accumulated: DecimalString;
  netBookValue: DecimalString;
}

/** Full straight-line schedule from the in-service month. Disposed assets stop at the month before disposal. */
export function depreciationSchedule(asset: FixedAsset): DepreciationRow[] {
  if (asset.method !== "STRAIGHT_LINE") throw new Error(`Unsupported depreciation method: ${asset.method}`);
  if (asset.usefulLifeMonths <= 0) return [];
  const depreciable = D(asset.cost).minus(D(asset.salvageValue));
  if (depreciable.lte(0)) return [];
  const amounts = allocate(depreciable, Array<number>(asset.usefulLifeMonths).fill(1), 2);
  const rows: DepreciationRow[] = [];
  let accumulated = D(0);
  const disposalMonth = asset.disposedDate ? monthKey(asset.disposedDate) : undefined;
  for (let i = 0; i < asset.usefulLifeMonths; i++) {
    const month = monthKey(addMonths(asset.inServiceDate, i));
    if (disposalMonth && month >= disposalMonth) break;
    accumulated = accumulated.plus(D(amounts[i]));
    rows.push({
      month,
      amount: money(amounts[i]),
      accumulated: money(accumulated),
      netBookValue: money(D(asset.cost).minus(accumulated)),
    });
  }
  return rows;
}

export function depreciationForMonth(asset: FixedAsset, month: string): DecimalString {
  const row = depreciationSchedule(asset).find((r) => r.month === month);
  return row ? row.amount : money(0);
}

export function accumulatedDepreciationThrough(asset: FixedAsset, month: string): DecimalString {
  let acc = D(0);
  for (const r of depreciationSchedule(asset)) {
    if (r.month > month) break;
    acc = acc.plus(D(r.amount));
  }
  return money(acc);
}

export function netBookValue(asset: FixedAsset, month: string): DecimalString {
  return sub(asset.cost, accumulatedDepreciationThrough(asset, month));
}

/** Whether a (non-void) DEPRECIATION entry for the month already exists in the ledger. */
export function depreciationEntryExists(ledger: Ledger, month: string): boolean {
  return ledger.dataset.journalEntries.some((e) => e.source === "DEPRECIATION" && e.status !== "VOID" && (e.tags ?? []).includes(`month:${month}`));
}

/**
 * Build the monthly depreciation entry for all in-service assets (Dr expense / Cr accumulated
 * depreciation per asset). Returns null when no asset depreciates in that month.
 */
export function buildDepreciationEntry(ledger: Ledger, month: string, opts: { id?: ID; post?: boolean } = {}): NewJournalEntryInput | null {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`Invalid month: ${month}`);
  const lines: NewJournalLineInput[] = [];
  const sourceIds: ID[] = [];
  for (const asset of ledger.dataset.fixedAssets) {
    const amount = depreciationForMonth(asset, month);
    if (D(amount).isZero()) continue;
    ledger.requireAccount(asset.depreciationExpenseAccountId);
    ledger.requireAccount(asset.accumulatedDepreciationAccountId);
    lines.push({ accountId: asset.depreciationExpenseAccountId, debit: amount, memo: `Depreciation ${asset.name} ${month}` });
    lines.push({ accountId: asset.accumulatedDepreciationAccountId, credit: amount, memo: `Accumulated depreciation ${asset.name} ${month}` });
    sourceIds.push(asset.id);
  }
  if (!lines.length) return null;
  return {
    id: opts.id,
    date: monthEnd(`${month}-01`),
    description: `Monthly depreciation ${month}`,
    source: "DEPRECIATION",
    lines,
    sourceIds,
    tags: ["depreciation", `month:${month}`],
    post: opts.post,
  };
}
