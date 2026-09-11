import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { MATERIALITY_CONFIG_KEYS, MATERIALITY_CONFIG_SECTION, type MaterialityKey } from "@/lib/risk/materiality";
import { answerConfig } from "@/lib/ui/config";
import { decimalOrNull } from "@/lib/ui/data";
import { toPlain } from "@/lib/ui/serialize";

const LABELS: Record<MaterialityKey, string> = { transactionReviewAmount: "Transaction review amount (forces YELLOW)", redAmount: "Red amount (forces RED)", forecastChangeAmount: "Material forecast change ($)", forecastChangeRatio: "Material forecast change (ratio)", varianceRatio: "Material budget variance (ratio)", minimumCashReserve: "Minimum cash reserve policy" };

/** Confirm materiality thresholds; they take effect on the live risk engine immediately. */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<{ values?: Partial<Record<MaterialityKey, string | number | null>> }>(req);
  const values = body.values ?? {};
  const rt = await getRuntime();
  const updated: string[] = [];
  for (const [k, raw] of Object.entries(values) as [MaterialityKey, string | number | null][]) {
    if (!(k in MATERIALITY_CONFIG_KEYS)) return apiError(`Unknown threshold ${k}`);
    if (raw === null || raw === "" || raw === undefined) continue;
    const isRatio = k === "forecastChangeRatio" || k === "varianceRatio";
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0 || (isRatio && num > 1)) return apiError(`${k} must be ${isRatio ? "a ratio between 0 and 1" : "a non-negative amount"}`);
    const value = isRatio ? num : decimalOrNull(raw);
    await answerConfig(rt, actor, { key: MATERIALITY_CONFIG_KEYS[k], value, status: "CONFIRMED", section: MATERIALITY_CONFIG_SECTION, label: LABELS[k], note: "Confirmed in the console by the owner.", eventType: "MATERIALITY_CONFIRMED" });
    updated.push(k);
  }
  return json({ updated, thresholds: toPlain(rt.thresholds), message: updated.length ? `Confirmed ${updated.join(", ")}` : "Nothing changed" });
}, "EDIT_CONFIG");
