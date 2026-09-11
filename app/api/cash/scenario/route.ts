import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, readJson, apiError } from "@/lib/ui/api";
import { thirteenWeek, decimalOrNull } from "@/lib/ui/data";
import { toPlain } from "@/lib/ui/serialize";
import { isValidISODate } from "@/lib/core/dates";

interface Body {
  delayDays?: number;
  receiptHaircut?: number;
  extraDisbursement?: { amount?: string | number; date?: string; label?: string } | null;
  asOf?: string;
}

export const POST = withApi(async (req) => {
  const body = await readJson<Body>(req);
  const rt = await getRuntime();
  const delayDays = Number(body.delayDays ?? 0);
  const haircut = Number(body.receiptHaircut ?? 0);
  if (!Number.isFinite(delayDays) || delayDays < 0 || delayDays > 365) return apiError("delayDays must be 0..365");
  if (!Number.isFinite(haircut) || haircut < 0 || haircut > 1) return apiError("receiptHaircut must be 0..1");
  const extraAmount = decimalOrNull(body.extraDisbursement?.amount);
  const extra = extraAmount && extraAmount !== "0.0000" ? { amount: extraAmount, date: body.extraDisbursement?.date && isValidISODate(body.extraDisbursement.date) ? body.extraDisbursement.date : undefined, label: body.extraDisbursement?.label } : undefined;
  const asOf = body.asOf && isValidISODate(body.asOf) ? body.asOf : rt.asOfDate;
  const forecast = thirteenWeek(rt, { delayDays, receiptHaircut: haircut, extraDisbursement: extra }, asOf);
  return json({ forecast: toPlain(forecast) });
}, "VIEW_FINANCIALS");
