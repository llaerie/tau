/**
 * Tax operations tools. Tax rules are data: a calculation runs only with a usable (CURRENT,
 * sourced, reviewed, approved) TaxRule; anything else escalates to the CPA. Questions go through
 * the tax guard; prohibited categories are never answered autonomously. Filing is refused.
 */
import type { Assumption, CalcResult, DecimalString, TaxRule } from "@/lib/core/types";
import { nowISO } from "@/lib/core/dates";
import { D, money } from "@/lib/core/money";
import { makeCalc } from "@/lib/finance/calc-result";
import { buildTaxCalendar, calendarSummary } from "@/lib/tax/calendar";
import { buildTaxDocumentChecklist } from "@/lib/tax/checklist";
import { explainTaxQuestion } from "@/lib/tax/guard";
import { buildTaxWorkpaper, workpaperSections } from "@/lib/tax/workpapers";
import { extractEntities } from "../intent";
import { TASKS } from "../task-catalog";
import { defineTool } from "../types";
import { esc, insufficient, moneyFigure, ok, pct, propose, textFigure } from "./common";
import { cpaQueueFor, loadWorkflows, numbersIn, runtimeFromContext, summarizeUnknown, taxRuleStoreFor } from "./runtime-bridge";

const CPA_JUDGMENT = ["Tax treatment, deductibility, elections and positions are professional judgments for the CPA; the system supplies facts and rule-based calculations only.", "Every figure here is preliminary until the CPA reviews the workpaper."];

export const taxCalendarTool = defineTool({
  name: "tax_calendar",
  description: "Tax obligations calendar for a tax year built from TaxRule records (unknown due dates stay unknown).",
  riskLevel: "GREEN",
  capabilityKey: "tax_calendar",
  inputSchema: TASKS["tax.calendar"].params,
  async execute(input, ctx) {
    const asOf = input.asOf ?? ctx.asOfDate;
    const taxYear = input.taxYear ?? Number(asOf.slice(0, 4));
    const store = taxRuleStoreFor(ctx.dataset);
    const obligations = buildTaxCalendar(ctx.dataset, taxYear, store, asOf);
    const s = calendarSummary(obligations);
    const known = obligations.filter((o) => o.dueDate).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
    const facts = obligations.map((o) => `${o.title}${o.periodLabel ? ` ${o.periodLabel}` : ""}: due ${o.dueDate ?? "UNKNOWN (rule pending)"}, status ${o.status}`);
    return ok({
      answer: `Tax calendar ${taxYear}: ${s.total} obligation(s) tracked; ${s.unknownDueDates} have unknown due dates because their rules are not yet retrieved/approved (${s.upcoming} upcoming, ${s.due} past due by rule). ${known.length ? `Known dates: ${known.slice(0, 6).map((o) => `${o.kind}${o.periodLabel ? ` ${o.periodLabel}` : ""} ${o.dueDate}`).join("; ")}.` : "No due dates are confirmed yet — none are assumed."}`,
      escalation: s.unknownDueDates ? esc("CPA_REVIEW_REQUIRED", `${s.unknownDueDates} obligation(s) have no usable due-date rule; the CPA must confirm the dates (rules are data, never memory).`, { requiredRole: "CPA", missingItems: obligations.filter((o) => !o.dueDate).map((o) => o.kind) }) : undefined,
      numbers: [textFigure("Obligations", s.total), textFigure("Unknown due dates", s.unknownDueDates), textFigure("Upcoming", s.upcoming), textFigure("Past due", s.due)],
      why: facts.slice(0, 12),
      risks: s.due ? ["Some obligations appear past due by their rule; confirm filing status with the CPA/payroll provider."] : [],
      educationKey: "estimated_taxes",
      confidence: s.unknownDueDates ? 0.6 : 0.85,
      sourceLayers: known.length ? ["AUTHORITATIVE", "COMPANY"] : ["COMPANY"],
      highRisk: { facts, calculations: ["Due dates derived only from usable TaxRule parameters; no arithmetic on amounts."], assumptions: obligations.filter((o) => !o.dueDate).map((o) => `${o.kind}: due date UNKNOWN — ${o.notes?.[o.notes.length - 1] ?? "rule pending"}`), professionalJudgment: ["Which obligations apply (payroll returns, information returns, Statement of Information timing) is confirmed by the CPA."] },
      structured: { value: s.total, values: { total: s.total, unknownDueDates: s.unknownDueDates, upcoming: s.upcoming, due: s.due }, obligations: obligations.map((o) => ({ id: o.id, kind: o.kind, jurisdiction: o.jurisdiction, periodLabel: o.periodLabel ?? null, dueDate: o.dueDate, status: o.status, ruleSourceId: o.ruleSourceId ?? null })), taxYear },
    }, { sourceIds: obligations.map((o) => o.ruleSourceId).filter((x): x is string => Boolean(x)) });
  },
});

function computeWithRule(rule: TaxRule, inputs: Record<string, string | number>, asOf: string, sourceIds: string[]): { calc: CalcResult<DecimalString | null>; missing: string[] } {
  const p = rule.parameters ?? {};
  const base = inputs.base ?? inputs.income ?? inputs.wages ?? inputs.amount ?? inputs.netIncome;
  const rate = typeof p.rate === "number" || typeof p.rate === "string" ? D(p.rate) : null;
  const flat = typeof p.amount === "number" || typeof p.amount === "string" ? D(p.amount) : null;
  const minimum = typeof p.minimum === "number" || typeof p.minimum === "string" ? D(p.minimum) : null;
  const missing: string[] = [];
  let value: DecimalString | null = null;
  let formula = "";
  if (rate) {
    if (base === undefined) missing.push("base amount (inputs.base)");
    else {
      let v = D(base).times(rate);
      formula = `tax = base × rate (${rate.toString()})`;
      if (minimum && v.lt(minimum)) {
        v = minimum;
        formula += `; floored at minimum ${minimum.toString()}`;
      }
      value = v.toFixed(4);
    }
  } else if (flat) {
    value = flat.toFixed(4);
    formula = `flat amount from rule (${flat.toString()})`;
  } else missing.push(`usable parameters on rule ${rule.key} (rate or amount)`);
  const assumptions: Assumption[] = [{ key: `tax_rule:${rule.key}`, description: `Rule ${rule.key} (${rule.status}, review by ${rule.reviewBy}) from source ${rule.sourceId}`, value: rule.parameters ?? null, status: rule.status === "CURRENT" ? "CONFIRMED" : "PROFESSIONAL_REVIEW_REQUIRED", sourceId: rule.sourceId, requiresProfessionalReview: rule.status !== "CURRENT" }];
  const calc = makeCalc<DecimalString | null>({ name: `tax_calc_${rule.key}`, value, unit: "USD", formula: formula || "no usable parameters", inputs: { ruleId: rule.id, parameters: rule.parameters ?? null, base: base ?? null, inputs }, asOfDate: asOf, sourceIds: [rule.id, rule.sourceId, ...sourceIds], assumptions, notes: missing.length ? [`INSUFFICIENT_INFORMATION: ${missing.join(", ")}`] : [] });
  return { calc, missing };
}

export const calculateWithRuleTool = defineTool({
  name: "tax_calculate_with_rule",
  description: "Calculate with an approved TaxRule (rate × base or flat amount); unusable rules escalate to the CPA.",
  riskLevel: "GREEN",
  capabilityKey: "tax_workpapers",
  inputSchema: TASKS["tax.calculate_with_rule"].params,
  async execute(input, ctx) {
    const taxYear = input.taxYear ?? Number(ctx.asOfDate.slice(0, 4));
    const store = taxRuleStoreFor(ctx.dataset);
    let rule: TaxRule | null;
    let usable: boolean;
    let reason: string;
    let escalation = null as ReturnType<typeof esc> | null;
    const overrideSource = input.ruleOverride?.sourceId ? store.getSource(input.ruleOverride.sourceId) : undefined;
    const overrideUsable = Boolean(input.ruleOverride && input.ruleOverride.status === "CONFIRMED" && overrideSource);
    if (input.ruleOverride) {
      const seed = store.find(input.ruleKey, taxYear);
      rule = { id: `rule_${input.ruleKey}_${taxYear}_override`, jurisdiction: seed?.jurisdiction ?? "OTHER", taxYear, key: input.ruleKey, title: seed?.title ?? input.ruleKey, normalizedRule: seed?.normalizedRule ?? "override supplied with request", parameters: input.ruleOverride.parameters, sourceId: input.ruleOverride.sourceId ?? seed?.sourceId ?? "src_request_override", status: input.ruleOverride.status as TaxRule["status"], confidence: 0.5, reviewBy: ctx.asOfDate, approvedBy: undefined };
      usable = false;
      reason = `Rule parameters were supplied with the request (status ${input.ruleOverride.status}); a request-supplied rule is never authoritative.`;
      escalation = null;
      if (!overrideUsable) escalation = esc("CPA_REVIEW_REQUIRED", reason, { requiredRole: "CPA" });
      else {
        usable = true;
        reason = `Rule parameters confirmed by the CPA with source ${overrideSource!.id} (${overrideSource!.layer}, ${overrideSource!.status}).`;
      }
    } else {
      const res = store.resolveRule(input.ruleKey, taxYear, ctx.asOfDate);
      rule = res.rule;
      usable = res.usable;
      reason = res.reason;
      if (!usable) escalation = esc(res.escalation ?? "CPA_REVIEW_REQUIRED", reason, { requiredRole: "CPA", missingItems: [input.ruleKey] });
    }
    if (!rule) return ok({ ...insufficient([`tax rule ${input.ruleKey}`], `No tax rule "${input.ruleKey}" is registered for ${taxYear}; I can't calculate without a sourced rule.`), escalation: escalation ?? esc("INSUFFICIENT_INFORMATION", reason) });
    const facts = Object.entries(input.inputs).map(([k, v]) => `${k}: ${v}`);
    if (input.ruleOverride && !overrideUsable) {
      // A rate or amount supplied in the request without a professional confirmation AND a registered source is not an approved rule: nothing is computed with it.
      const registered = Boolean(overrideSource);
      const why = input.ruleOverride.status !== "CONFIRMED" ? `status ${input.ruleOverride.status}: the figure has not been confirmed by a professional` : !input.ruleOverride.sourceId ? "the confirmation cites no KnowledgeSource" : !registered ? `source ${input.ruleOverride.sourceId} is not a registered, reviewed KnowledgeSource` : "the override is not usable";
      const type = input.ruleOverride.status === "CONFIRMED" && !input.ruleOverride.sourceId ? "INSUFFICIENT_INFORMATION" : "CPA_REVIEW_REQUIRED";
      cpaQueueFor(ctx.dataset).addUnique({ topic: input.ruleKey, question: `Confirm rule ${input.ruleKey} for ${taxYear} (requester supplied parameters ${JSON.stringify(input.ruleOverride.parameters)})`, context: facts.join(" | "), urgency: "MEDIUM" });
      return ok({
        answer: `I can't apply the ${input.ruleKey} figure you supplied: ${why}. Tax rules are data that must come from an approved, sourced TaxRule — a value from memory, a website or the request itself is never used in a calculation, so no amount is computed. The rule has been queued for CPA confirmation.`,
        escalation: esc(type, `Requester-supplied rule parameters for ${input.ruleKey} are not an approved rule (${why}).`, { requiredRole: "CPA", missingItems: [`approved TaxRule ${input.ruleKey} with a registered KnowledgeSource`] }),
        why: [why, `Registered rule status: ${rule.status}; ${reason}`],
        recommendation: "Ask the CPA to confirm the rate against its authoritative source; once the TaxRule is CURRENT and approved the calculation runs deterministically.",
        confidence: 0.6,
        highRisk: { facts, calculations: ["None — requester-supplied parameters are never used."], assumptions: [`Requester-supplied parameters ${JSON.stringify(input.ruleOverride.parameters)} (NOT USED)`], professionalJudgment: CPA_JUDGMENT },
        structured: { value: null, ruleKey: input.ruleKey, ruleStatus: rule.status, usable: false, overrideRejected: true, reason: why },
      }, { sourceIds: [rule.id] });
    }
    const { calc, missing } = computeWithRule(rule, input.inputs, ctx.asOfDate, []);
    const assumptions = calc.assumptions.map((a) => `[${a.status}] ${a.description}`);
    if (!usable) {
      return ok({
        answer: `I can't compute ${input.ruleKey} for ${taxYear}: ${reason} The rule exists but is not usable, so no number is produced.`,
        escalation: escalation!,
        why: [reason],
        confidence: 0.5,
        highRisk: { facts, calculations: ["None — rule unusable."], assumptions, professionalJudgment: CPA_JUDGMENT },
        structured: { value: null, ruleKey: input.ruleKey, ruleStatus: rule.status, usable: false, reason },
      }, { calcs: [calc], sourceIds: [rule.id, rule.sourceId] });
    }
    if (calc.value === null) return ok({ ...insufficient(missing, `Rule ${input.ruleKey} is available but ${missing.join("; ")}.`), highRisk: { facts, calculations: [], assumptions, professionalJudgment: CPA_JUDGMENT } }, { calcs: [calc] });
    const layer = overrideSource?.layer ?? store.getSource(rule.sourceId)?.layer;
    return ok({
      answer: `Using rule ${rule.key} (${input.ruleOverride ? `confirmed with source ${overrideSource!.id}` : rule.status}): ${calc.formula} = ${calc.value}. The CPA still reviews the workpaper before the figure is used for a filing.`,
      escalation: escalation ?? esc("CPA_REVIEW_REQUIRED", "Tax calculations are preliminary until the CPA reviews the workpaper.", { requiredRole: "CPA" }),
      sourceRefs: overrideSource ? [{ id: overrideSource.id, kind: "KNOWLEDGE" as const, label: overrideSource.title, status: overrideSource.status }] : undefined,
      numbers: [moneyFigure(`${rule.key} result`, calc.value, calc.id), ...facts.map((f) => textFigure(f.split(":")[0], f.split(":")[1].trim()))],
      why: [calc.formula, `Rule source ${rule.sourceId}; review by ${rule.reviewBy}.`],
      confidence: usable ? 0.85 : 0.55,
      sourceLayers: [layer ?? (usable ? "AUTHORITATIVE" : "COMPANY")],
      highRisk: { facts, calculations: [`${calc.formula} = ${calc.value} [${calc.id}]`], assumptions, professionalJudgment: CPA_JUDGMENT },
      structured: { value: calc.value, values: { result: calc.value }, ruleKey: input.ruleKey, ruleStatus: rule.status, usable, ruleId: rule.id, sourceId: overrideSource?.id ?? rule.sourceId },
    }, { calcs: [calc], sourceIds: [rule.id, overrideSource?.id ?? rule.sourceId] });
  },
});

const QUESTION_RULE_HINTS: [RegExp, string][] = [
  [/franchise tax|ca minimum|minimum tax|\$800/i, "ca_s_corp_minimum_franchise_tax"],
  [/franchise tax rate|1\.5%|california s.?corp rate/i, "ca_s_corp_franchise_tax_rate"],
  [/social security (rate|tax)|fica rate/i, "fed_social_security_rate"],
  [/wage base/i, "fed_social_security_wage_base"],
  [/medicare/i, "fed_medicare_rate"],
  [/futa/i, "futa_rate"],
  [/sdi/i, "ca_sdi_rate"],
  [/sui|unemployment insurance rate/i, "ca_sui_rate_new_employer"],
  [/meals?\b.*(deduct|50|100)/i, "meals_deductibility"],
  [/home office/i, "home_office_rules"],
  [/1120-?s.*(due|deadline)|s.?corp.*(return|filing).*(due|deadline|when)/i, "fed_s_corp_return_due"],
  [/941.*(due|deadline|when)/i, "fed_941_quarterly_due"],
  [/1099.*(due|deadline|when)/i, "fed_1099_nec_due"],
];

export const taxQuestionTool = defineTool({
  name: "tax_question",
  description: "Route a natural-language tax question through the tax guard: prohibited → professional review; judgment → CPA queue; calculation → approved rule or escalation.",
  riskLevel: "YELLOW",
  capabilityKey: "tax_workpapers",
  inputSchema: TASKS["tax.question"].params,
  async execute(input, ctx) {
    const guard = explainTaxQuestion(input.question);
    const taxYear = input.taxYear ?? Number(ctx.asOfDate.slice(0, 4));
    const queue = cpaQueueFor(ctx.dataset);
    const facts = [`Question: ${input.question}`, `Tax year ${taxYear}`, `Entity: ${ctx.dataset.profile.entityType.value ?? "UNKNOWN"} / election ${ctx.dataset.profile.taxElection.value ?? "UNKNOWN"} (${ctx.dataset.profile.taxElection.status})`];
    if (guard.classification === "PROHIBITED_AUTONOMOUS") {
      const reasonableComp = guard.prohibitedCategories.includes("REASONABLE_COMPENSATION_DECISION");
      const type = reasonableComp || guard.prohibitedCategories.includes("AGGRESSIVE_POSITION") ? "CPA_REVIEW_REQUIRED" : "PROFESSIONAL_REVIEW_REQUIRED";
      const item = queue.addUnique({ topic: guard.prohibitedCategories.join(","), question: input.question, context: facts.join(" | "), urgency: "HIGH" });
      const judgment = [guard.reason, ...(reasonableComp ? ["Reasonable compensation is decided with the CPA on documented facts (role, hours, comparable pay, revenue, distributions)."] : []), ...(guard.prohibitedCategories.includes("WORKER_CLASSIFICATION") ? ["Worker classification is a legal determination for the CPA/attorney."] : []), ...(guard.prohibitedCategories.includes("ENTITY_ELECTION_CHANGE") ? ["Entity and election changes require attorney and CPA advice and owner approval."] : [])];
      return ok({
        answer: `This is a ${guard.prohibitedCategories.map((c) => c.toLowerCase().replace(/_/g, " ")).join(" / ")} question, which I don't answer on my own — it needs ${type === "CPA_REVIEW_REQUIRED" ? "the CPA" : "a licensed professional"}. I've added it to the review queue (${item.id}) with the facts below.`,
        escalation: esc(type, guard.reason, { requiredRole: guard.prohibitedCategories.includes("WORKER_CLASSIFICATION") || guard.prohibitedCategories.includes("ENTITY_ELECTION_CHANGE") ? "ATTORNEY" : "CPA" }),
        why: facts,
        recommendation: "Discuss with the CPA; I can prepare the supporting workpaper (facts, calculations, assumptions) for that conversation.",
        confidence: 0.9,
        highRisk: { facts, calculations: ["None — no calculation is appropriate without professional guidance."], assumptions: [], professionalJudgment: judgment },
        structured: { value: null, classification: guard.classification, prohibitedCategories: guard.prohibitedCategories, cpaQueueItemId: item.id, facts, professionalJudgment: judgment },
      });
    }
    if (guard.classification === "TAX_LAW_JUDGMENT") {
      const item = queue.addUnique({ topic: "tax_law_judgment", question: input.question, context: facts.join(" | "), urgency: "MEDIUM" });
      return ok({
        answer: `That requires tax-law judgment rather than a rule lookup, so I've queued it for the CPA (${item.id}) with the facts on record. I can gather more facts or run a calculation once the CPA confirms the treatment.`,
        escalation: esc("CPA_REVIEW_REQUIRED", guard.reason, { requiredRole: "CPA" }),
        why: facts,
        confidence: 0.85,
        highRisk: { facts, calculations: ["None pending CPA guidance."], assumptions: [], professionalJudgment: [guard.reason, ...CPA_JUDGMENT] },
        structured: { value: null, classification: guard.classification, cpaQueueItemId: item.id, facts },
      });
    }
    // CALCULATE_WITH_APPROVED_RULE
    const hint = QUESTION_RULE_HINTS.find(([re]) => re.test(input.question));
    const store = taxRuleStoreFor(ctx.dataset);
    if (!hint) {
      const item = queue.addUnique({ topic: "tax_calculation_unmapped", question: input.question, context: facts.join(" | "), urgency: "LOW" });
      return ok({ answer: `This looks like a calculation, but I couldn't map it to a registered tax rule, so I won't guess a rate or date. Queued for the CPA (${item.id}).`, escalation: esc("CPA_REVIEW_REQUIRED", "No registered rule matches the question.", { requiredRole: "CPA" }), why: facts, confidence: 0.6, highRisk: { facts, calculations: [], assumptions: [], professionalJudgment: CPA_JUDGMENT }, structured: { value: null, classification: guard.classification, cpaQueueItemId: item.id } });
    }
    const res = store.resolveRule(hint[1], taxYear, ctx.asOfDate);
    if (!res.usable || !res.rule) {
      const item = queue.addUnique({ topic: hint[1], question: input.question, context: `${facts.join(" | ")} | ${res.reason}`, urgency: "MEDIUM" });
      return ok({
        answer: `This maps to rule "${hint[1]}", but that rule is not usable yet: ${res.reason} I won't quote a rate or date from memory — queued for CPA confirmation (${item.id}).`,
        escalation: esc(res.escalation ?? "CPA_REVIEW_REQUIRED", res.reason, { requiredRole: "CPA", missingItems: [hint[1]] }),
        why: facts,
        confidence: 0.6,
        highRisk: { facts, calculations: ["None — rule unusable."], assumptions: [`Rule ${hint[1]} status ${res.rule?.status ?? "missing"}`], professionalJudgment: CPA_JUDGMENT },
        structured: { value: null, classification: guard.classification, ruleKey: hint[1], ruleStatus: res.rule?.status ?? null, usable: false, cpaQueueItemId: item.id },
      }, { sourceIds: res.rule ? [res.rule.id] : [] });
    }
    const e = extractEntities(input.question, ctx.asOfDate);
    const base = e.amounts[0];
    const { calc, missing } = computeWithRule(res.rule, base ? { base } : {}, ctx.asOfDate, []);
    if (calc.value === null) return ok({ ...insufficient(missing, `Rule ${hint[1]} is usable but ${missing.join("; ")}.`), highRisk: { facts, calculations: [], assumptions: [], professionalJudgment: CPA_JUDGMENT }, structured: { value: null, ruleKey: hint[1], usable: true, missing } }, { calcs: [calc] });
    return ok({
      answer: `Using approved rule ${res.rule.key}: ${calc.formula} = ${calc.value}. This is a rule-based calculation; the CPA still reviews the workpaper.`,
      escalation: esc("CPA_REVIEW_REQUIRED", "Tax calculations are preliminary until the CPA reviews the workpaper.", { requiredRole: "CPA" }),
      numbers: [moneyFigure(`${res.rule.key}`, calc.value, calc.id)],
      why: [calc.formula, res.reason],
      confidence: 0.8,
      sourceLayers: ["AUTHORITATIVE"],
      highRisk: { facts, calculations: [`${calc.formula} = ${calc.value} [${calc.id}]`], assumptions: calc.assumptions.map((a) => `[${a.status}] ${a.description}`), professionalJudgment: CPA_JUDGMENT },
      structured: { value: calc.value, values: { result: calc.value }, ruleKey: hint[1], usable: true, classification: guard.classification },
    }, { calcs: [calc], sourceIds: [res.rule.id, res.rule.sourceId] });
  },
});

export const taxWorkpaperTool = defineTool({
  name: "tax_workpaper",
  description: "Build a tax workpaper (facts from the ledger, calculations, assumptions, professional-judgment items) for a tax year; CPA review always required.",
  riskLevel: "GREEN",
  capabilityKey: "tax_workpapers",
  inputSchema: TASKS["tax.workpaper"].params,
  async execute(input, ctx) {
    const y = input.taxYear;
    const from = `${y}-01-01`;
    const to = `${y}-12-31` < ctx.asOfDate ? `${y}-12-31` : ctx.asOfDate;
    const is = ctx.ledger.incomeStatement(from, to);
    const bal = (code: string) => (ctx.ledger.getAccount(code) ? ctx.ledger.accountBalance(`acct_${code}`, to, from) : "0.0000");
    const officer = bal("6010");
    const dist = D(bal("3100")).abs().toFixed(4);
    const entries = ctx.dataset.journalEntries.filter((e) => e.status === "POSTED" && e.date >= from && e.date <= to).map((e) => e.id).slice(-40);
    const calcs = [
      makeCalc<DecimalString>({ name: "book_net_income", value: is.netIncome, unit: "USD", formula: "income statement net income (book basis)", inputs: { from, to }, asOfDate: to, sourceIds: entries }),
      makeCalc<DecimalString>({ name: "officer_compensation", value: officer, unit: "USD", formula: "sum(6010 Officer Compensation)", inputs: { from, to }, asOfDate: to, sourceIds: entries }),
      makeCalc<DecimalString>({ name: "shareholder_distributions", value: dist, unit: "USD", formula: "sum(3100 Shareholder Distributions)", inputs: { from, to }, asOfDate: to, sourceIds: entries }),
    ];
    const assumptions: Assumption[] = [{ key: "book_tax_differences", description: "Book-to-tax adjustments (meals, depreciation method, accruals) are not applied; the CPA determines them.", value: null, status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true }];
    if (to < `${y}-12-31`) assumptions.push({ key: "partial_year", description: `Figures cover ${from} to ${to} (year in progress).`, value: to, status: "CONFIRMED" });
    const wp = buildTaxWorkpaper({ title: `${input.topic ?? "Annual"} workpaper ${y}`, taxYear: y, jurisdiction: "FEDERAL", facts: [{ label: "Revenue", value: is.revenue, sourceIds: entries }, { label: "Total expenses", value: D(is.revenue).minus(D(is.netIncome)).toFixed(4), sourceIds: entries }, { label: "Officer compensation", value: officer, sourceIds: entries }, { label: "Shareholder distributions", value: dist, sourceIds: entries }, { label: "Entity / election", value: `${ctx.dataset.profile.entityType.value ?? "UNKNOWN"} / ${ctx.dataset.profile.taxElection.value ?? "UNKNOWN"}`, sourceIds: [] }], calculations: calcs, assumptions, professionalJudgmentItems: ["Reasonable compensation vs distributions", "Deductibility of meals, home office and related-party items", "Depreciation method for tax", "State franchise tax computation"], createdBy: ctx.actor.id, createdAt: nowISO() });
    ctx.dataset.taxWorkpapers.push(wp);
    await ctx.store.upsert("taxWorkpapers", wp);
    const hr = workpaperSections(wp, calcs);
    return ok({
      answer: `Workpaper ${wp.id} for ${y}: revenue ${is.revenue}, book net income ${is.netIncome}, officer compensation ${officer}, distributions ${dist}. Confidence ${wp.confidence} — CPA review required before any figure is used for a return.`,
      escalation: esc("CPA_REVIEW_REQUIRED", "Tax workpapers always require CPA review in Phase One.", { requiredRole: "CPA" }),
      numbers: [moneyFigure("Revenue", is.revenue), moneyFigure("Book net income", is.netIncome, calcs[0].id), moneyFigure("Officer compensation", officer, calcs[1].id), moneyFigure("Distributions", dist, calcs[2].id)],
      why: hr.facts,
      confidence: wp.confidence,
      highRisk: hr,
      structured: { value: is.netIncome, values: { revenue: is.revenue, bookNetIncome: is.netIncome, officerCompensation: officer, distributions: dist }, workpaperId: wp.id, workpaperConfidence: wp.confidence },
    }, { calcs, assumptions, sourceIds: entries });
  },
});

export const documentChecklistTool = defineTool({
  name: "tax_document_checklist",
  description: "Tax document checklist status for a tax year (what is on file, what is missing).",
  riskLevel: "GREEN",
  capabilityKey: "tax_workpapers",
  inputSchema: TASKS["tax.document_checklist"].params,
  async execute(input, ctx) {
    const c = buildTaxDocumentChecklist(ctx.dataset, input.taxYear);
    const missing = c.items.filter((i) => i.required && !i.present);
    return ok({
      answer: `Tax document checklist ${input.taxYear}: ${c.presentCount}/${c.items.length} items present; ${c.missingRequiredCount} required item(s) missing${missing.length ? ` — ${missing.slice(0, 6).map((i) => i.label).join("; ")}` : ""}.`,
      escalation: missing.length ? esc("INSUFFICIENT_INFORMATION", `${missing.length} required document group(s) missing.`, { missingItems: missing.map((i) => i.key) }) : undefined,
      numbers: [textFigure("Present", c.presentCount), textFigure("Missing required", c.missingRequiredCount), textFigure("Items", c.items.length)],
      why: c.items.map((i) => `${i.present ? "✓" : "✗"} ${i.label}${i.missingDetail?.length ? ` (missing: ${i.missingDetail.slice(0, 4).join(", ")}${i.missingDetail.length > 4 ? "…" : ""})` : ""}`),
      confidence: 0.9,
      highRisk: { facts: c.items.map((i) => `${i.label}: ${i.present ? "present" : "MISSING"}`), calculations: ["None."], assumptions: [], professionalJudgment: ["Which forms and payees are required is confirmed by the CPA."] },
      structured: { value: c.missingRequiredCount, values: { present: c.presentCount, missingRequired: c.missingRequiredCount, total: c.items.length }, items: c.items.map((i) => ({ key: i.key, label: i.label, required: i.required, present: i.present, documentIds: i.documentIds, missingDetail: i.missingDetail ?? [] })) },
    }, { sourceIds: c.items.flatMap((i) => i.documentIds) });
  },
});

export const cpaPackageTool = defineTool({
  name: "cpa_package",
  description: "Generate the CPA package for a period (delegates to lib/workflows.buildCpaPackage).",
  riskLevel: "GREEN",
  capabilityKey: "cpa_package",
  inputSchema: TASKS["tax.cpa_package"].params,
  async execute(input, ctx) {
    const wf = await loadWorkflows();
    if (!wf?.buildCpaPackage) {
      const is = ctx.ledger.incomeStatement(input.from, input.to);
      const bs = ctx.ledger.balanceSheet(input.to);
      return ok({ answer: `The CPA package workflow is not available yet. Core figures for ${input.from}–${input.to}: revenue ${is.revenue}, net income ${is.netIncome}, cash ${bs.cash}, total assets ${bs.totalAssets}.`, escalation: esc("OUT_OF_SCOPE", "lib/workflows.buildCpaPackage is not available; only summary statements were produced."), numbers: [moneyFigure("Revenue", is.revenue), moneyFigure("Net income", is.netIncome), moneyFigure("Cash", bs.cash)], confidence: 0.5, structured: { value: is.netIncome, values: { revenue: is.revenue, netIncome: is.netIncome, cash: bs.cash }, packageAvailable: false } });
    }
    const pkg = await wf.buildCpaPackage(runtimeFromContext(ctx), input.from, input.to);
    const summary = summarizeUnknown(pkg);
    const nums = numbersIn(pkg).slice(0, 12);
    return ok({
      answer: `CPA package for ${input.from}–${input.to} prepared with ${summary.count} section(s): ${summary.fields.map((f) => `${f.key} (${f.summary})`).join(", ")}. It is a package for the CPA — nothing is filed.`,
      escalation: esc("CPA_REVIEW_REQUIRED", "The package is for CPA review; filings and positions are the CPA's.", { requiredRole: "CPA" }),
      numbers: nums.map((n) => textFigure(n.key, n.value)),
      confidence: 0.8,
      highRisk: { facts: summary.fields.map((f) => `${f.key}: ${f.summary}`), calculations: nums.map((n) => `${n.key} = ${n.value}`), assumptions: ["Book-to-tax adjustments are for the CPA."], professionalJudgment: CPA_JUDGMENT },
      structured: { value: null, packageAvailable: true, package: pkg, sections: summary.fields.map((f) => f.key) },
    });
  },
});

export const fileReturnTool = defineTool({
  name: "file_tax_return",
  description: "Any request to file/sign/submit a return: proposes FILE_TAX_RETURN (RED, blocked) and returns the preparation status instead.",
  riskLevel: "RED",
  capabilityKey: "tax_filing",
  inputSchema: TASKS["tax.file_return"].params,
  async execute(input, ctx) {
    const action = propose(ctx, { kind: "FILE_TAX_RETURN", description: `File/sign: ${input.description}`, reason: input.description, payload: { description: input.description }, context: { touchesTax: true }, reversible: false });
    const year = Number(ctx.asOfDate.slice(0, 4));
    const c = buildTaxDocumentChecklist(ctx.dataset, year);
    return ok({
      answer: `I can't file or sign a tax return — that is prohibited in Phase One and is always done by the CPA and owner. What I can do: the ${year} document checklist has ${c.presentCount}/${c.items.length} items present (${c.missingRequiredCount} required missing), and I can assemble the CPA package and workpapers.`,
      escalation: esc("REFUSED_CONTROL_VIOLATION", "FILE_TAX_RETURN cannot execute in Phase One (simulation only); returns are prepared and filed by the CPA and signed by the owner.", { requiredRole: "CPA" }),
      numbers: [textFigure("Checklist present", c.presentCount), textFigure("Required missing", c.missingRequiredCount)],
      recommendation: "Ask for the CPA package; send it to the CPA for preparation and filing.",
      confidence: 0.95,
      highRisk: { facts: [`Request: ${input.description}`], calculations: ["None."], assumptions: [], professionalJudgment: ["Return preparation, positions and filing are the CPA's; signature is the owner's."] },
      structured: { value: null, riskLevel: "RED", actionsExecuted: 0, checklistPresent: c.presentCount, checklistMissingRequired: c.missingRequiredCount },
    }, { proposedActions: [action] });
  },
});

export const shareholderSummaryTool = defineTool({
  name: "shareholder_summary",
  description: "Shareholder wages (6010) versus distributions (3100) for a tax year — calculation only, reasonable compensation is CPA judgment.",
  riskLevel: "GREEN",
  capabilityKey: "tax_workpapers",
  inputSchema: TASKS["tax.shareholder_summary"].params,
  async execute(input, ctx) {
    const y = input.taxYear;
    const from = `${y}-01-01`;
    const to = `${y}-12-31` < ctx.asOfDate ? `${y}-12-31` : ctx.asOfDate;
    if (!ctx.ledger.getAccount("6010") || !ctx.ledger.getAccount("3100")) return ok(insufficient(["accounts 6010 and 3100"], "The chart of accounts lacks officer compensation / distributions accounts."));
    const wages = ctx.ledger.accountBalance("acct_6010", to, from);
    const dist = D(ctx.ledger.accountBalance("acct_3100", to, from)).abs().toFixed(4);
    const total = D(wages).plus(D(dist));
    const ratio = total.isZero() ? null : D(wages).div(total).toNumber();
    const entries = ctx.dataset.journalEntries.filter((e) => e.status === "POSTED" && e.date >= from && e.date <= to && e.lines.some((l) => l.accountId === "acct_6010" || l.accountId === "acct_3100")).map((e) => e.id);
    const calc = makeCalc({ name: "shareholder_wages_vs_distributions", value: { wages, distributions: dist, wagesShare: ratio }, unit: "OBJECT", formula: "wages = sum(6010); distributions = sum(3100); wages_share = wages / (wages + distributions)", inputs: { from, to }, asOfDate: to, sourceIds: entries });
    const facts = [`Officer compensation (6010) ${from}–${to}: ${wages}`, `Shareholder distributions (3100) ${from}–${to}: ${dist}`, `Entries considered: ${entries.length}`];
    const judgment = ["Whether wages are reasonable relative to distributions is a CPA judgment; no benchmark is applied here.", "Distributions in excess of basis have tax consequences the CPA evaluates (basis is UNKNOWN in this system)."];
    cpaQueueFor(ctx.dataset).addUnique({ topic: "reasonable_compensation", question: `Review ${y} wages ${wages} vs distributions ${dist}`, context: facts.join(" | "), urgency: "MEDIUM" });
    return ok({
      answer: `${y} to date: officer wages ${wages} and shareholder distributions ${dist} (wages are ${ratio === null ? "n/a" : pct(ratio)} of the total ${total.toFixed(4)}). Whether that split is reasonable compensation is for the CPA — queued for review.`,
      escalation: esc("CPA_REVIEW_REQUIRED", "Salary vs distribution split is a reasonable-compensation judgment.", { requiredRole: "CPA" }),
      numbers: [moneyFigure("Officer wages", wages, calc.id), moneyFigure("Distributions", dist), textFigure("Wages share", pct(ratio))],
      why: facts,
      educationKey: "owner_salary_vs_distribution",
      confidence: 0.85,
      highRisk: { facts, calculations: [`wages share = ${wages} / ${total.toFixed(4)} = ${pct(ratio)} [${calc.id}]`], assumptions: ["Owner basis unknown — not assumed."], professionalJudgment: judgment },
      structured: { value: wages, values: { wages, distributions: dist, wagesShare: ratio, total: total.toFixed(4) }, facts, professionalJudgment: judgment },
    }, { calcs: [calc], sourceIds: entries });
  },
});

export const taxTools = [taxCalendarTool, calculateWithRuleTool, taxQuestionTool, taxWorkpaperTool, documentChecklistTool, cpaPackageTool, fileReturnTool, shareholderSummaryTool];
export { money };
