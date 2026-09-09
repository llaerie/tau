/**
 * Materiality thresholds for the risk engine.
 *
 * The lab defaults below are UNCONFIRMED: they are reasonable starting points for a
 * small S-corp but are not company facts. `thresholdsFromConfig` upgrades individual
 * values when a CONFIRMED `ConfigField` exists for them; the overall status becomes
 * CONFIRMED only when every threshold that drives risk classification is confirmed.
 */
import type { MaterialityThresholds } from "@/lib/core/contracts";
import type { ConfigField, DecimalString, FieldStatus } from "@/lib/core/types";
import { money } from "@/lib/core/money";

export const MATERIALITY_CONFIG_SECTION = "materiality";

/** Config keys the risk engine reads (section "materiality"). */
export const MATERIALITY_CONFIG_KEYS = {
  transactionReviewAmount: "materiality.transactionReviewAmount",
  redAmount: "materiality.redAmount",
  forecastChangeAmount: "materiality.forecastChangeAmount",
  forecastChangeRatio: "materiality.forecastChangeRatio",
  varianceRatio: "materiality.varianceRatio",
  minimumCashReserve: "materiality.minimumCashReserve",
} as const;

export type MaterialityKey = keyof typeof MATERIALITY_CONFIG_KEYS;

/** Lab defaults. Status UNCONFIRMED: nobody has told us these are the company's policy. */
export const DEFAULT_MATERIALITY: MaterialityThresholds = Object.freeze({
  transactionReviewAmount: "500.00",
  redAmount: "10000.00",
  forecastChangeAmount: "5000.00",
  forecastChangeRatio: 0.1,
  varianceRatio: 0.1,
  minimumCashReserve: null,
  status: "UNCONFIRMED",
});

const REQUIRED_FOR_CONFIRMED: MaterialityKey[] = [
  "transactionReviewAmount",
  "redAmount",
  "forecastChangeAmount",
  "forecastChangeRatio",
  "varianceRatio",
];

function confirmedField(fields: ConfigField[], key: string): ConfigField | undefined {
  return fields.find((f) => f.key === key && f.status === "CONFIRMED" && f.value !== null && f.value !== undefined);
}

function asDecimal(v: unknown): DecimalString | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") {
    try {
      return money(v);
    } catch {
      return null;
    }
  }
  return null;
}

function asRatio(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

/**
 * Build thresholds from config fields. Only CONFIRMED, non-null fields override the
 * defaults; anything else keeps the lab default and leaves the status UNCONFIRMED.
 */
export function thresholdsFromConfig(
  configFields: ConfigField[],
  base: MaterialityThresholds = DEFAULT_MATERIALITY,
): MaterialityThresholds {
  const out: MaterialityThresholds = { ...base };
  const confirmed = new Set<MaterialityKey>();

  const dec = (k: MaterialityKey): DecimalString | null => asDecimal(confirmedField(configFields, MATERIALITY_CONFIG_KEYS[k])?.value);
  const rat = (k: MaterialityKey): number | null => asRatio(confirmedField(configFields, MATERIALITY_CONFIG_KEYS[k])?.value);

  const tra = dec("transactionReviewAmount");
  if (tra !== null) {
    out.transactionReviewAmount = tra;
    confirmed.add("transactionReviewAmount");
  }
  const red = dec("redAmount");
  if (red !== null) {
    out.redAmount = red;
    confirmed.add("redAmount");
  }
  const fca = dec("forecastChangeAmount");
  if (fca !== null) {
    out.forecastChangeAmount = fca;
    confirmed.add("forecastChangeAmount");
  }
  const fcr = rat("forecastChangeRatio");
  if (fcr !== null) {
    out.forecastChangeRatio = fcr;
    confirmed.add("forecastChangeRatio");
  }
  const vr = rat("varianceRatio");
  if (vr !== null) {
    out.varianceRatio = vr;
    confirmed.add("varianceRatio");
  }
  const mcr = dec("minimumCashReserve");
  if (mcr !== null) {
    out.minimumCashReserve = mcr;
    confirmed.add("minimumCashReserve");
  }

  const allConfirmed = REQUIRED_FOR_CONFIRMED.every((k) => confirmed.has(k));
  const status: FieldStatus = allConfirmed ? "CONFIRMED" : "UNCONFIRMED";
  out.status = status;
  return out;
}

/** Config fields (UNCONFIRMED) that describe the lab defaults, for seeding the config screen. */
export function materialityConfigFields(t: MaterialityThresholds = DEFAULT_MATERIALITY): ConfigField[] {
  const mk = (key: MaterialityKey, label: string, value: unknown): ConfigField => ({
    key: MATERIALITY_CONFIG_KEYS[key],
    section: MATERIALITY_CONFIG_SECTION,
    label,
    value,
    status: t.status,
    requiredConfirmer: "OWNER",
    note: "Lab default; confirm to make this the company's materiality policy.",
    synthetic: true,
  });
  return [
    mk("transactionReviewAmount", "Transaction review amount (forces YELLOW)", t.transactionReviewAmount),
    mk("redAmount", "Red amount (forces RED)", t.redAmount),
    mk("forecastChangeAmount", "Material forecast change ($)", t.forecastChangeAmount),
    mk("forecastChangeRatio", "Material forecast change (ratio)", t.forecastChangeRatio),
    mk("varianceRatio", "Material budget variance (ratio)", t.varianceRatio),
    mk("minimumCashReserve", "Minimum cash reserve policy", t.minimumCashReserve),
  ];
}
