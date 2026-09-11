/**
 * CFO orchestrator tools: financial health summary, concept explanations, finance-setup status,
 * and the weekly brief / attention queue (delegated to lib/workflows and lib/monitors, lazily).
 */
import type { DecimalString } from "@/lib/core/types";
import { D } from "@/lib/core/money";
import { arAging } from "@/lib/finance/aging";
import { makeCalc } from "@/lib/finance/calc-result";
import { burnRate, cashRunway } from "@/lib/finance/cash";
import { EDUCATION_SNIPPETS, educationFor, type EducationConceptKey } from "@/lib/knowledge/education";
import { blockedCapabilities, buildFinanceBible, unknownsRegistry } from "@/lib/knowledge/finance-bible";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, figure, insufficient, moneyFigure, ok, textFigure } from "./common";
import { loadMonitors, loadWorkflows, runtimeFromContext, summarizeUnknown } from "./runtime-bridge";
import { ledgerCash, monthlyCashBalances } from "./treasury-tools";

export const healthSummaryTool = defineTool({
  name: "health_summary",
  description: "Financial health snapshot: cash, burn/runway, overdue AR, ledger integrity and open setup unknowns.",
  riskLevel: "GREEN",
  capabilityKey: "financial_statements",
  inputSchema: TASKS["cfo.health"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const cash = ledgerCash(ctx, asOf);
    const cashCalc = makeCalc<DecimalString>({ name: "cash_position", value: cash.total, unit: "USD", formula: "sum(cash account balances)", inputs: { asOf }, asOfDate: asOf, sourceIds: cash.byAccount.map((b) => b.accountId) });
    const burn = burnRate({ monthlyCashBalances: monthlyCashBalances(ctx, asOf, 3), months: 3, asOfDate: asOf });
    const runway = cashRunway({ cash: cash.total, burnRate: burn.value, asOfDate: asOf });
    const ar = arAging(ctx.dataset.invoices, asOf, ctx.dataset.customers);
    const integrity = ctx.ledger.runIntegrityChecks(asOf);
    const unknowns = unknownsRegistry(buildFinanceBible()).filter((u) => u.status !== "CONFIRMED");
    const ytd = ctx.ledger.incomeStatement(`${asOf.slice(0, 4)}-01-01`, asOf);
    const failing = integrity.checks.filter((c) => !c.passed);
    const risks: string[] = [];
    if (!integrity.passed) risks.push(`${failing.length} integrity check(s) failing: ${failing.map((c) => c.key).join(", ")}.`);
    if (runway.value !== null && runway.value < 6) risks.push(`Runway ${runway.value.toFixed(1)} months at the trailing burn.`);
    if (D(ar.value.overdueTotal).gt(0)) risks.push(`Overdue receivables ${ar.value.overdueTotal} across ${ar.value.overdue.length} invoice(s).`);
    if (ctx.thresholds.minimumCashReserve === null) risks.push("Minimum cash reserve policy is not set; reserve coverage cannot be judged.");
    return ok({
      answer: `As of ${asOf}: cash ${cash.total}; ${burn.value === null ? "burn unknown (no history)" : D(burn.value).lte(0) ? "cash-flow positive over the trailing 3 months" : `burn ${burn.value}/month → runway ${runway.value === null ? "n/a" : `${runway.value.toFixed(1)} months`}`}; YTD revenue ${ytd.revenue} and net income ${ytd.netIncome}; AR ${ar.value.total} (${ar.value.overdueTotal} overdue); ledger integrity ${integrity.passed ? "clean" : `${failing.length} issue(s)`}; ${unknowns.length} finance-setup item(s) still unconfirmed.`,
      numbers: [figure("Cash", cashCalc), figure("Monthly burn", burn), figure("Runway", runway), moneyFigure("YTD revenue", ytd.revenue), moneyFigure("YTD net income", ytd.netIncome), moneyFigure("AR total", ar.value.total, ar.id), moneyFigure("AR overdue", ar.value.overdueTotal), textFigure("Integrity checks failing", failing.length), textFigure("Setup unknowns", unknowns.length)],
      why: ["Cash and statements come from posted ledger entries; burn is the trailing 3-month average change in cash; AR from open invoices; unknowns from the finance bible."],
      risks,
      recommendation: risks.length ? "Address the flagged items in order: integrity, cash reserve policy, collections." : "No urgent issues; keep the weekly brief cadence.",
      educationKey: "cash_vs_profit",
      confidence: integrity.passed ? 0.85 : 0.65,
      structured: { value: cash.total, values: { cash: cash.total, monthlyBurn: burn.value, runwayMonths: runway.value, ytdRevenue: ytd.revenue, ytdNetIncome: ytd.netIncome, arTotal: ar.value.total, arOverdue: ar.value.overdueTotal, integrityFailing: failing.length, setupUnknowns: unknowns.length }, integrityPassed: integrity.passed, unknownKeys: unknowns.map((u) => u.key) },
    }, { calcs: [cashCalc, burn, runway, ar] });
  },
});

/** Deterministic glossary for concepts the education library does not cover (no rates, no legal conclusions). */
const GLOSSARY: { keys: RegExp[]; title: string; text: string; educationKey?: EducationConceptKey }[] = [
  { keys: [/retained earnings/i, /closing entr/i, /year[- ]end clos/i, /close the books/i, /temporary accounts?/i], title: "Closing entries and retained earnings", text: "At year end the revenue and expense accounts (temporary accounts) are closed: their balances are reset to zero by closing entries, and the net income (or loss) they produced is transferred into Retained Earnings in equity on the balance sheet. Retained earnings therefore accumulate every year's profit less any distributions paid to the shareholder; the income statement starts the new year from zero." },
  { keys: [/cash (vs|versus|and|or) accrual/i, /accrual (vs|versus|and|or) cash/i, /accrual accounting/i, /cash basis/i], title: "Cash vs. accrual accounting", text: "Cash-basis accounting records revenue when cash is received and expenses when cash is paid. Accrual-basis accounting records revenue when it is earned and expenses when they are incurred, using receivables, payables, prepaids and accruals to place activity in the right period. Accrual books give a truer picture of profitability; cash books track liquidity. The method the company uses for its books and its tax return is a confirmed company fact (see the finance setup), and a change of method is a CPA decision.", educationKey: "accrual_basis" },
  { keys: [/capital allocation/i, /allocat\w* .*(budget|capital|money|funds)/i, /split .* between .* projects?/i, /which project/i], title: "Capital allocation between projects", text: "Money is allocated between projects by comparing the return each one is expected to generate: the NPV and IRR of each project's cash flows, the payback period, and the risk around those estimates. Without an expected return (cash flows, timing and a discount rate) for each project there is no basis to split a budget, so the inputs need to be gathered first. Nothing is allocated by default." },
  { keys: [/double[- ]entry/i, /debits? (and|&) credits?/i], title: "Double-entry bookkeeping", text: "Every transaction is recorded twice, as equal debits and credits, so the books always balance: assets = liabilities + equity. Debits increase assets and expenses; credits increase liabilities, equity and revenue." },
  { keys: [/materiality/i], title: "Materiality", text: "Materiality is the size of an amount or error at which a reasonable reader's decision would change. The company sets materiality thresholds (transaction review amount, RED amount, variance ratio) that decide when an item needs human review or approval; until the owner confirms them, the lab defaults are labelled unconfirmed." },
];

export const explainConceptTool = defineTool({
  name: "explain_concept",
  description: "Explain a finance concept briefly from the education library (no rates, no legal conclusions).",
  riskLevel: "GREEN",
  capabilityKey: "education",
  inputSchema: TASKS["cfo.explain_concept"].params,
  async execute(input) {
    const raw = input.concept.trim();
    if (!raw) return ok(insufficient(["a concept to explain"], "Tell me which finance concept you want explained."));
    const q = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
    const glossary = GLOSSARY.find((g) => g.keys.some((k) => k.test(raw)));
    if (glossary) {
      const edu = glossary.educationKey ? educationFor(glossary.educationKey) : undefined;
      return ok({ answer: `${glossary.title}: ${glossary.text}${edu ? ` ${edu.whyItMatters}` : ""}`, educationKey: glossary.educationKey, confidence: 0.9, sourceLayers: ["EDUCATION"], structured: { value: glossary.title, concept: glossary.title, title: glossary.title, source: "glossary" } });
    }
    const key = q.replace(/\s+/g, "_") as EducationConceptKey;
    let snippet = educationFor(key);
    if (!snippet) {
      const words = q.split(/\s+/).filter((w) => w.length > 2 && !["what", "does", "mean", "the", "and", "with", "between", "our", "how", "explain"].includes(w));
      let best: { s: (typeof EDUCATION_SNIPPETS)[number]; score: number } | null = null;
      for (const s of EDUCATION_SNIPPETS) {
        const hay = `${s.key.replace(/_/g, " ")} ${s.title.toLowerCase()}`;
        const hayWords = hay.split(/[^a-z0-9]+/).filter(Boolean);
        const score = words.filter((w) => hay.includes(w)).length;
        const coverage = hayWords.filter((h) => h.length > 2 && words.includes(h)).length / Math.max(1, hayWords.filter((h) => h.length > 2).length);
        if (score > 0 && coverage >= 0.5 && (!best || score > best.score)) best = { s, score };
      }
      snippet = best?.s;
    }
    if (!snippet) return ok({ answer: `I don't have an education note for "${raw}" and I won't improvise one. Available topics: ${EDUCATION_SNIPPETS.map((s) => s.title).join(", ")}, plus ${GLOSSARY.map((g) => g.title).join(", ")}.`, escalation: esc("OUT_OF_SCOPE", `No education snippet for "${raw}".`), confidence: 0.5, structured: { value: null, available: EDUCATION_SNIPPETS.map((s) => s.key) } });
    return ok({ answer: `${snippet.title}: ${snippet.whyItMatters}`, educationKey: snippet.key, confidence: 0.95, sourceLayers: ["EDUCATION"], structured: { value: snippet.key, concept: snippet.key, title: snippet.title, topics: snippet.topics } });
  },
});

export const configStatusTool = defineTool({
  name: "config_status",
  description: "Finance-setup completeness: which company facts are still unknown and what they block.",
  riskLevel: "GREEN",
  capabilityKey: "policy_management",
  inputSchema: TASKS["cfo.config_status"].params,
  async execute() {
    const bible = buildFinanceBible();
    const items = unknownsRegistry(bible);
    const byStatus: Record<string, number> = {};
    for (const i of items) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    const open = items.filter((i) => i.status !== "CONFIRMED");
    const blocked = blockedCapabilities(bible);
    return ok({
      answer: `Finance setup: ${items.length - open.length}/${items.length} items confirmed; ${open.length} open (${Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(", ")}). ${Object.keys(blocked).length} capabilit${Object.keys(blocked).length === 1 ? "y is" : "ies are"} blocked until they are answered.`,
      numbers: [textFigure("Setup items", items.length), textFigure("Confirmed", items.length - open.length), textFigure("Open", open.length), textFigure("Blocked capabilities", Object.keys(blocked).length)],
      why: open.slice(0, 12).map((i) => `${i.label} [${i.status}] — ask ${i.whoCanAnswer}: ${i.whyItMatters.slice(0, 120)}`),
      recommendation: open.length ? `Start with the items the OWNER can answer (${open.filter((i) => i.whoCanAnswer === "OWNER").length}) and send the CPA list (${open.filter((i) => i.whoCanAnswer === "CPA").length}) in one batch.` : "Setup is complete.",
      confidence: 0.95,
      sourceLayers: ["COMPANY"],
      structured: { value: open.length, values: { total: items.length, open: open.length, confirmed: items.length - open.length }, byStatus, items: items.map((i) => ({ key: i.key, fieldKey: i.fieldKey, label: i.label, status: i.status, whoCanAnswer: i.whoCanAnswer, blocksCapabilities: i.blocksCapabilities })), blockedCapabilities: blocked },
    });
  },
});

type BriefLike = { executiveSummary?: string; cashToday?: { total?: string }; thirteenWeekLowestCash?: { amount?: string; weekStart?: string }; revenueReceived?: { monthToDate?: string }; revenueExpected?: { overdueTotal?: string }; attentionQueue?: { total?: number; critical?: number }; topDecisions?: unknown[]; recommendedActions?: { title?: string }[]; calcIds?: string[]; sourceIds?: string[] };

export const weeklyBriefTool = defineTool({
  name: "weekly_brief",
  description: "Weekly CFO briefing (delegates to lib/workflows.buildWeeklyBrief).",
  riskLevel: "GREEN",
  capabilityKey: "financial_statements",
  inputSchema: TASKS["cfo.weekly_brief"].params,
  async execute(input, ctx) {
    const wf = await loadWorkflows();
    if (!wf?.buildWeeklyBrief) return ok({ ...insufficient(["lib/workflows.buildWeeklyBrief"], "The weekly brief workflow is not available yet; ask for the financial health summary instead."), escalation: esc("OUT_OF_SCOPE", "lib/workflows.buildWeeklyBrief is not available.") });
    const brief = (await wf.buildWeeklyBrief(runtimeFromContext(ctx), input.asOf ?? ctx.asOfDate)) as BriefLike;
    const s = summarizeUnknown(brief, 20);
    return ok({
      answer: brief.executiveSummary ?? `Weekly brief prepared with ${s.count} sections: ${s.fields.map((f) => f.key).join(", ")}.`,
      numbers: [moneyFigure("Cash today", brief.cashToday?.total ?? null), moneyFigure(`13-week low${brief.thirteenWeekLowestCash?.weekStart ? ` (${brief.thirteenWeekLowestCash.weekStart})` : ""}`, brief.thirteenWeekLowestCash?.amount ?? null), moneyFigure("Revenue month-to-date", brief.revenueReceived?.monthToDate ?? null), moneyFigure("Overdue receivables", brief.revenueExpected?.overdueTotal ?? null), textFigure("Attention items", brief.attentionQueue?.total ?? "n/a"), textFigure("Decisions pending", Array.isArray(brief.topDecisions) ? brief.topDecisions.length : "n/a")],
      why: (brief.recommendedActions ?? []).slice(0, 6).map((a) => a.title ?? "").filter(Boolean),
      confidence: 0.85,
      structured: { value: brief.cashToday?.total ?? null, values: { cash: brief.cashToday?.total ?? null, lowestCash13w: brief.thirteenWeekLowestCash?.amount ?? null, revenueMtd: brief.revenueReceived?.monthToDate ?? null, overdueAr: brief.revenueExpected?.overdueTotal ?? null, attentionItems: brief.attentionQueue?.total ?? null }, brief, sections: s.fields.map((f) => f.key) },
    }, { sourceIds: brief.sourceIds ?? [] });
  },
});

type AttentionLike = { id: string; kind: string; severity: string; title: string; detail?: string; amount?: string; dueDate?: string; suggestedTask?: { kind: string; params?: Record<string, unknown> }; relatedIds?: string[] };

export const attentionQueueTool = defineTool({
  name: "attention_queue",
  description: "What needs attention now (delegates to lib/monitors.buildAttentionQueue).",
  riskLevel: "GREEN",
  capabilityKey: "liquidity_monitoring",
  inputSchema: TASKS["cfo.attention"].params,
  async execute(input, ctx) {
    const mon = await loadMonitors();
    if (!mon?.buildAttentionQueue) return ok({ ...insufficient(["lib/monitors.buildAttentionQueue"], "The monitors module is not available yet; ask for the financial health summary instead."), escalation: esc("OUT_OF_SCOPE", "lib/monitors.buildAttentionQueue is not available.") });
    const items = ((await mon.buildAttentionQueue(runtimeFromContext(ctx), input.asOf ?? ctx.asOfDate)) as AttentionLike[]) ?? [];
    const bySeverity: Record<string, number> = {};
    for (const i of items) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
    return ok({
      answer: items.length ? `${items.length} item(s) need attention (${Object.entries(bySeverity).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(", ")}): ${items.slice(0, 5).map((i) => `${i.title}${i.amount ? ` (${i.amount})` : ""}`).join("; ")}.` : "Nothing needs attention right now.",
      numbers: [textFigure("Items", items.length), ...Object.entries(bySeverity).map(([s, n]) => textFigure(s, n))],
      why: items.slice(0, 10).map((i) => `[${i.severity}] ${i.title}: ${i.detail ?? ""}`),
      recommendation: items[0] ? `Start with "${items[0].title}"${items[0].suggestedTask ? ` (task ${items[0].suggestedTask.kind})` : ""}.` : "No action needed.",
      confidence: 0.85,
      structured: { value: items.length, values: { total: items.length, ...bySeverity }, items: items.map((i) => ({ id: i.id, kind: i.kind, severity: i.severity, title: i.title, amount: i.amount ?? null, dueDate: i.dueDate ?? null, suggestedTask: i.suggestedTask ?? null, relatedIds: i.relatedIds ?? [] })) },
    }, { sourceIds: items.flatMap((i) => i.relatedIds ?? []).slice(0, 40) });
  },
});

export const cfoTools = [healthSummaryTool, explainConceptTool, configStatusTool, weeklyBriefTool, attentionQueueTool];
