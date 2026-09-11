/**
 * Adapters from concurrently-built module outputs (attention queue, financial health,
 * weekly brief) to the shapes the console renders. Defensive: unknown shapes degrade
 * to labelled generic rows instead of throwing.
 */
import type { AttentionItem, HealthScorecard, HealthMetric } from "./data";
import { fmtMoney } from "./format";
import { CASH_UNKNOWN_LABEL } from "@/lib/db/workspace";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);

function sevOf(v: unknown): AttentionItem["severity"] {
  const t = s(v).toUpperCase();
  if (t === "RED" || t === "CRITICAL" || t === "HIGH" || t === "BLOCKING") return "RED";
  if (t === "YELLOW" || t === "MEDIUM" || t === "WARNING" || t === "WARN") return "YELLOW";
  if (t === "GREEN" || t === "LOW" || t === "OK") return "GREEN";
  return "INFO";
}

function hrefForKind(kind: string): string | undefined {
  const k = kind.toUpperCase();
  if (k.includes("CASH")) return "/cash";
  if (k.includes("TAX")) return "/tax";
  if (k.includes("PAYROLL") || k.includes("WORKER")) return "/payroll";
  if (k.includes("APPROVAL")) return "/approvals";
  if (k.includes("INVOICE") || k.includes("RECEIVABLE") || k.includes("AR_")) return "/ar";
  if (k.includes("BILL") || k.includes("PAYABLE") || k.includes("VENDOR") || k.includes("AP_")) return "/ap";
  if (k.includes("DOCUMENT") || k.includes("RECEIPT")) return "/documents";
  if (k.includes("TRANSACTION") || k.includes("DUPLICATE") || k.includes("CATEGOR")) return "/transactions";
  if (k.includes("BUDGET") || k.includes("VARIANCE") || k.includes("FORECAST")) return "/budget";
  if (k.includes("CLOSE") || k.includes("PERIOD") || k.includes("LEDGER") || k.includes("INTEGRITY")) return "/accounting";
  if (k.includes("SETUP") || k.includes("CONFIG") || k.includes("UNKNOWN")) return "/company";
  return undefined;
}

export function normalizeAttention(raw: unknown): AttentionItem[] {
  const list: unknown[] = Array.isArray(raw) ? raw : isRec(raw) ? ((raw.items ?? raw.queue ?? raw.alerts ?? []) as unknown[]) : [];
  return list.filter(isRec).map((r, i) => ({
    id: s(r.id, `att_${i}`),
    severity: sevOf(r.severity ?? r.level ?? r.risk ?? r.riskLevel),
    kind: s(r.kind ?? r.type ?? r.category, "MONITOR"),
    title: s(r.title ?? r.summary ?? r.message ?? r.label, "Attention item"),
    detail: s(r.detail ?? r.description ?? r.explanation ?? r.why, ""),
    href: typeof r.href === "string" ? r.href : typeof r.link === "string" ? r.link : hrefForKind(s(r.kind ?? r.type)),
  }));
}

function statusOf(v: unknown): HealthMetric["status"] {
  const t = s(v).toUpperCase();
  if (t === "GREEN" || t === "GOOD" || t === "OK") return "GREEN";
  if (t === "YELLOW" || t === "WATCH") return "YELLOW";
  if (t === "RED" || t === "ACTION") return "RED";
  return "UNKNOWN";
}

const HEALTH_LABELS: Record<string, string> = {
  cash: "Cash vs reserve",
  runwayMonths: "Cash runway",
  arOverdue: "AR overdue",
  integrityPassed: "Ledger integrity",
  unknownConfigCount: "Unanswered setup items",
  openApprovals: "Open approvals",
  budgetVariance: "Budget variance",
};

function healthDisplay(key: string, m: Rec): string {
  const v = m.value;
  if (key === "cash" && (m.known === false || v === null)) return CASH_UNKNOWN_LABEL;
  if (key === "cash" || key === "arOverdue" || key === "budgetVariance") return typeof v === "string" ? fmtMoney(v) : v === null ? "unknown" : s(v, "—");
  if (key === "runwayMonths") return typeof v === "number" ? `${v.toFixed(1)} months` : typeof m.burnRate === "string" && m.burnRate.startsWith("-") ? "Cash-flow positive" : "unknown";
  if (key === "integrityPassed") return v === true ? "All checks pass" : `${Array.isArray(m.failingChecks) ? m.failingChecks.length : "?"} failing`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return v === null || v === undefined ? "unknown" : s(v, "—");
}

export function normalizeHealth(raw: unknown, asOf: string): HealthScorecard {
  const r = isRec(raw) ? raw : {};
  const metrics: HealthMetric[] = [];
  // lib/workflows FinancialHealth: keyed HealthMetric objects
  for (const [key, label] of Object.entries(HEALTH_LABELS)) {
    const m = r[key];
    if (!isRec(m) || !("status" in m)) continue;
    const extra = key === "cash" ? (m.minimumReserve === null ? "reserve policy not set" : `reserve ${fmtMoney(s(m.minimumReserve))}`) : key === "arOverdue" ? `${s(m.count, "0")} invoices` : key === "openApprovals" ? `${s(m.red, "0")} red · ${s(m.yellow, "0")} yellow` : key === "budgetVariance" ? (m.flaggedCount === null ? "no budget" : `${s(m.flaggedCount)} flagged`) : "";
    metrics.push({ key, label, value: healthDisplay(key, m), status: statusOf(m.status), note: [s(m.note), extra].filter(Boolean).join(" · "), calcId: typeof m.calcId === "string" ? m.calcId : undefined });
  }
  // Generic array shapes
  const list: unknown[] = Array.isArray(r.metrics) ? r.metrics : Array.isArray(r.indicators) ? r.indicators : Array.isArray(r.items) ? r.items : [];
  for (const [i, m] of list.filter(isRec).entries()) {
    metrics.push({ key: s(m.key ?? m.id, `m_${i}`), label: s(m.label ?? m.name ?? m.title, `Metric ${i + 1}`), value: s(m.display ?? m.formatted ?? m.value, "—"), status: statusOf(m.status ?? m.level ?? m.risk), note: s(m.note ?? m.formula ?? m.explanation, ""), calcId: typeof m.calcId === "string" ? m.calcId : undefined });
  }
  return { asOf: s(r.asOfDate ?? r.asOf, asOf), overall: statusOf(r.overall ?? r.status ?? r.level), metrics, source: "lib/workflows.financialHealth" };
}

export interface BriefView {
  title: string;
  summary: string;
  markdown: string | null;
  keyNumbers: { label: string; value: string; note?: string }[];
  sections: { title: string; body: string }[];
}

export function normalizeBrief(raw: unknown, markdown: string | null): BriefView {
  const r = isRec(raw) ? raw : {};
  const money = (v: unknown) => (v === null ? CASH_UNKNOWN_LABEL : typeof v === "string" && /^-?\d/.test(v) ? fmtMoney(v) : s(v, "—"));
  const keyNumbers: BriefView["keyNumbers"] = [];
  // lib/workflows WeeklyBrief shape
  const cashKnown = !isRec(r.cashToday) || (r.cashToday as Rec).known !== false;
  if (isRec(r.cashToday)) keyNumbers.push({ label: "Cash today", value: cashKnown ? money((r.cashToday as Rec).total) : CASH_UNKNOWN_LABEL, note: cashKnown ? undefined : "no posted entries" });
  if (isRec(r.thirteenWeekLowestCash)) {
    const t = r.thirteenWeekLowestCash as Rec;
    keyNumbers.push({ label: "13-week lowest cash", value: cashKnown ? money(t.amount) : CASH_UNKNOWN_LABEL, note: cashKnown && t.weekStart ? `week ${s(t.weekIndex)} · ${s(t.weekStart)}` : cashKnown ? undefined : "opening cash unknown" });
  }
  if (isRec(r.revenueReceived)) keyNumbers.push({ label: "Revenue MTD", value: money((r.revenueReceived as Rec).monthToDate), note: `7-day ${money((r.revenueReceived as Rec).trailing7Days)}` });
  if (isRec(r.revenueExpected)) keyNumbers.push({ label: "AR overdue", value: money((r.revenueExpected as Rec).overdueTotal), note: `next 30d ${money((r.revenueExpected as Rec).next30Days)}` });
  if (isRec(r.expenses) && isRec((r.expenses as Rec).monthToDate)) keyNumbers.push({ label: "Expenses MTD", value: money(((r.expenses as Rec).monthToDate as Rec).total) });
  if (isRec(r.billsUpcoming)) keyNumbers.push({ label: "Bills upcoming", value: money((r.billsUpcoming as Rec).total) });
  if (isRec(r.payrollUpcoming)) {
    const dates = (r.payrollUpcoming as Rec).nextPayDates;
    const first = Array.isArray(dates) && isRec(dates[0]) ? (dates[0] as Rec) : null;
    if (first) keyNumbers.push({ label: "Next payroll", value: s(first.date, "—"), note: `≈ ${money(first.projectedTotalEmployerCost)} employer cost` });
  }
  if (isRec(r.attentionQueue)) {
    const q = r.attentionQueue as Rec;
    keyNumbers.push({ label: "Attention queue", value: s(q.total, "0"), note: `${s(q.critical, "0")} critical · ${s(q.warning, "0")} warning` });
  }
  // Generic shapes
  const numbersRaw: unknown[] = Array.isArray(r.keyNumbers) ? r.keyNumbers : Array.isArray(r.numbers) ? r.numbers : [];
  for (const n of numbersRaw.filter(isRec)) keyNumbers.push({ label: s(n.label ?? n.name, "—"), value: s(n.display ?? n.formatted ?? n.value, "—"), note: typeof n.note === "string" ? n.note : undefined });
  const sectionsRaw: unknown[] = Array.isArray(r.sections) ? r.sections : [];
  const sections = sectionsRaw.filter(isRec).map((x) => ({ title: s(x.title ?? x.heading, "Section"), body: s(x.body ?? x.text ?? (Array.isArray(x.items) ? (x.items as unknown[]).map((i) => `- ${s(i)}`).join("\n") : ""), "") }));
  const summary = s(r.executiveSummary ?? r.summary ?? r.answer, "");
  return { title: s(r.title, "Weekly CFO brief"), summary, markdown, keyNumbers, sections };
}
