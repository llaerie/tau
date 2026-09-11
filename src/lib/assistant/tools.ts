import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import { draftAction, type ActionView } from "../actions-engine";
import { reviewItems } from "../assumptions";
import { AuthorizationError } from "../auth/authorize";
import type { Viewer } from "../auth/session";
import { getDb } from "../db";
import * as s from "../db/schema";
import { evaluatePurchase, formatCents, formatTotal, monthPeriod, subscriptionMonthly } from "../finance";
import { isKnown, type Total } from "../finance/money";
import { currentMonth, todayIso } from "../ids";
import { buildBriefing, buildCompanyView, buildHouseholdView, buildPartnerSummary, buildPersonalView, buildSpaceView, toPlannedSubscription, upcomingObligations } from "../views";
import { scenarioBaseline } from "../views/scenario";
import type { ResultComponent, ResultValue } from "./envelope";

/**
 * Tools the model may call. Identity, scope and permissions come from the
 * server-side viewer, never from model arguments. Read tools return data plus
 * a display component; draft tools create an action that still needs the
 * user's approval in the UI. There is no execute tool.
 */

export class ToolError extends Error {}

export type Scope = "me" | "company" | "household";

const scopeProp = { type: "string", enum: ["me", "company", "household"], description: "Which money to look at. Defaults to the user's own money." } as const;

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  { name: "get_briefing", description: "Short briefing for the signed-in person: next step, attention items, take-home status, upcoming payments.", input_schema: { type: "object", properties: {}, additionalProperties: false }, strict: true },
  { name: "get_money_summary", description: "Compact summary for a scope: personal (take-home, food, unallocated plan), company (recorded cash, expected receipts, known commitments, partial remainder, unknown costs) or household (company-paid bills, own bills).", input_schema: { type: "object", properties: { scope: scopeProp }, required: [], additionalProperties: false } },
  { name: "get_personal_food_plan", description: "The signed-in person's food target, spent so far this month, remaining, take-home status and missing inputs. Never returns another person's details.", input_schema: { type: "object", properties: {}, additionalProperties: false }, strict: true },
  { name: "search_transactions", description: "Search visible transactions (own personal space, company, household). Returns at most 25 rows.", input_schema: { type: "object", properties: { scope: scopeProp, month: { type: "string", description: "YYYY-MM" }, text: { type: "string" }, limit: { type: "integer" } }, required: [], additionalProperties: false } },
  { name: "get_upcoming_obligations", description: "Dated upcoming payments for a scope within a horizon of days.", input_schema: { type: "object", properties: { scope: scopeProp, horizon_days: { type: "integer" } }, required: [], additionalProperties: false } },
  { name: "get_subscription_plan", description: "Planned and active AI subscriptions, metered API usage, other SaaS; exact tiers, quantities, prices when confirmed, unknown otherwise.", input_schema: { type: "object", properties: {}, additionalProperties: false }, strict: true },
  { name: "explain_metric", description: "Explain where a number comes from: formula, inputs, assumptions, as-of date.", input_schema: { type: "object", properties: { metric_id: { type: "string" } }, required: ["metric_id"], additionalProperties: false }, strict: true },
  { name: "evaluate_purchase", description: "Deterministic check of a one-time or recurring purchase against a scope: cash, obligations, missing reserves, plan effects. Conditional when inputs are unknown.", input_schema: { type: "object", properties: { scope: scopeProp, amount_dollars: { type: "number" }, name: { type: "string" }, recurring: { type: "boolean" }, month_offset: { type: "integer", description: "0 = this month, 1 = next month" }, purpose: { type: "string", enum: ["business", "personal", "mixed", "unresolved"] } }, required: ["amount_dollars", "name"], additionalProperties: false } },
  { name: "get_review_items", description: "The setup/review queue: what is unknown and what it blocks.", input_schema: { type: "object", properties: {}, additionalProperties: false }, strict: true },
  { name: "get_partner_summary", description: "The partner's pre-approved coarse summary (food status, take-home status, rounded savings allocation). Never individual purchases.", input_schema: { type: "object", properties: {}, additionalProperties: false }, strict: true },
  { name: "draft_budget_change", description: "Prepare a change to the user's own food target or a personal allocation. Returns a preview that the user must approve in the UI.", input_schema: { type: "object", properties: { field: { type: "string", enum: ["foodTarget", "allocation"] }, amount_dollars: { type: "number" }, allocation_name: { type: "string" }, allocation_kind: { type: "string", enum: ["savings", "investment", "spending"] } }, required: ["field", "amount_dollars"], additionalProperties: false } },
  { name: "draft_expense", description: "Prepare a receipt or expense record for approval. Own purchases default to the user's own space and account. Use shares for a split meal.", input_schema: { type: "object", properties: { amount_dollars: { type: "number" }, description: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD, defaults to today" }, category: { type: "string", description: "e.g. Food & dining" }, scope: scopeProp, purpose: { type: "string", enum: ["business", "personal", "mixed", "unresolved"] }, beneficiary: { type: "string", enum: ["company", "household", "person", "split"] }, split_equally_with_partner: { type: "boolean" }, document_id: { type: "string" } }, required: ["amount_dollars", "description"], additionalProperties: false } },
  { name: "draft_purchase_plan", description: "Prepare a one-time purchase plan (hardware, furniture, other) for approval. Not a payment.", input_schema: { type: "object", properties: { name: { type: "string" }, amount_dollars: { type: "number" }, category: { type: "string", enum: ["hardware", "furniture", "software", "travel", "other"] }, target_month: { type: "string", description: "YYYY-MM" }, scope: scopeProp, beneficiary: { type: "string", enum: ["company", "household", "person", "split"] }, purpose: { type: "string", enum: ["business", "personal", "mixed", "unresolved"] }, notes: { type: "string" } }, required: ["name"], additionalProperties: false } },
  { name: "draft_subscription_change", description: "Prepare an update to a subscription record (tier, quantity, price, status). Nothing is purchased.", input_schema: { type: "object", properties: { subscription_id: { type: "string" }, provider: { type: "string" }, product: { type: "string" }, tier: { type: "string" }, quantity: { type: "integer" }, unit_price_dollars: { type: "number" }, interval: { type: "string", enum: ["monthly", "annual"] }, status: { type: "string", enum: ["planned", "active", "cancelled"] } }, required: ["provider", "product"], additionalProperties: false } },
];

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  component?: ResultComponent;
  draft?: ActionView;
  error?: string;
}

function money(t: Total): { value: string; status: ResultValue["status"] } {
  return t.complete ? { value: formatCents(t.knownCents), status: "known" } : t.knownCents === 0 ? { value: "Unknown", status: "unknown" } : { value: `${formatCents(t.knownCents)} so far`, status: "unknown" };
}

function mySpace(viewer: Viewer) {
  return viewer.spaces.find((sp) => sp.kind === "personal" && sp.personId === viewer.person?.id) ?? null;
}

function scopeSpace(viewer: Viewer, scope: string | undefined) {
  const sc = (scope ?? "me") as Scope;
  if (sc === "company") return viewer.spaces.find((sp) => sp.kind === "company") ?? fail("You cannot see the company space.");
  if (sc === "household") return viewer.spaces.find((sp) => sp.kind === "household") ?? fail("You cannot see the household space.");
  return mySpace(viewer) ?? fail("You do not have a personal space.");
}

function fail(msg: string): never {
  throw new ToolError(msg);
}

function dollarsToCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail("amount_dollars must be a positive number.");
  return Math.round(n * 100);
}

export function executeTool(viewer: Viewer, name: string, input: Record<string, unknown>): { result: unknown; component?: ResultComponent; draft?: ActionView } {
  const asOf = todayIso();
  switch (name) {
    case "get_briefing": {
      const b = buildBriefing(viewer);
      return { result: b, component: { kind: "review_items", title: "Briefing", values: [...(b.moneyLine ? [{ id: "take-home", label: b.moneyLine.label, value: b.moneyLine.value, note: b.moneyLine.caveat ?? undefined, status: (b.moneyLine.caveat ? "estimate" : "known") as ResultValue["status"] }] : [])], rows: b.attention.map((a) => ({ label: a.label, value: a.blocks, status: "attention" as const })), asOf } };
    }
    case "get_money_summary": {
      const sp = scopeSpace(viewer, input.scope as string | undefined);
      const v = buildSpaceView(viewer, sp.id);
      if (v.kind === "personal") {
        const f = v.food;
        return { result: { scope: "me", takeHome: v.takeHome.takeHome, takeHomeStatus: v.takeHome.status, foodTarget: f.foodTarget, foodSpent: f.foodSpentCents, unallocated: f.unallocated.total, nextStep: f.nextStep }, component: personalComponent(v) };
      }
      if (v.kind === "company") {
        const p = v.plan;
        return {
          result: { scope: "company", recordedCash: p.recordedCash.total, cashAsOf: v.cashAsOf, expectedReceipts: p.expectedReceipts.total, receivedThisMonth: p.receivedSoFar.total, knownCommitments: p.knownCommitments.total, partialRemainder: { ...p.partialRemainder.total, label: p.partialRemainder.label }, unknownCosts: p.unknownCosts, oneTimeThisMonth: p.oneTimeThisMonth, reviewItemsThisMonth: v.reviewCount },
          component: {
            kind: "money_summary",
            title: `${sp.name} · ${v.month}`,
            scope: "company",
            asOf: v.cashAsOf ?? asOf,
            values: [
              { id: "recorded-cash", label: `Recorded cash${v.cashAsOf ? ` (as of ${v.cashAsOf})` : ""}`, ...money(p.recordedCash.total), note: "Recorded, not reconciled." },
              { id: "expected-receipts", label: "Expected receipts", ...money(p.expectedReceipts.total), note: "Expected, not received." },
              { id: "received", label: "Received this month", ...money(p.receivedSoFar.total) },
              { id: "known-commitments", label: "Known monthly commitments", ...money(p.knownCommitments.total) },
              { id: "partial-remainder", label: "Partial remainder before unlisted costs", ...money(p.partialRemainder.total), status: "estimate", note: "Not profit, not a balance, not safe to spend." },
            ],
            missing: p.unknownCosts,
            metricId: "partial-remainder",
          },
        };
      }
      return {
        result: { scope: "household", companyPaidBills: v.companyPaidTotal, ownBills: v.ownBillsTotal, jointCash: v.cashTotal, groceriesThisMonth: v.groceriesThisMonthCents },
        component: {
          kind: "money_summary",
          title: `Household · ${v.month}`,
          scope: "household",
          asOf,
          values: [
            { id: "company-paid", label: "Shared bills paid by the company", ...money(v.companyPaidTotal), note: "A benefit paid by the company, not joint-account cash." },
            { id: "own-bills", label: "Bills paid from the joint account", ...money(v.ownBillsTotal) },
            { id: "joint-cash", label: "Joint account cash", ...money(v.cashTotal) },
            { id: "groceries", label: "Groceries this month", value: formatCents(v.groceriesThisMonthCents), status: "known" },
          ],
        },
      };
    }
    case "get_personal_food_plan": {
      const sp = mySpace(viewer) ?? fail("You do not have a personal space.");
      const v = buildPersonalView(viewer, sp.id);
      return { result: { foodTarget: v.food.foodTarget, foodSpent: v.food.foodSpentCents, foodRemaining: v.food.foodRemainingCents, foodStatus: v.food.foodStatus, takeHome: v.takeHome.takeHome, takeHomeStatus: v.takeHome.status, beforeIncomeTax: v.takeHome.beforeIncomeTax, gross: v.takeHome.gross, unallocated: v.food.unallocated.total, missing: [...v.takeHome.takeHome.unknowns, ...(v.food.foodTarget === null ? ["Food target not set"] : [])], nextStep: v.food.nextStep }, component: personalComponent(v) };
    }
    case "search_transactions": {
      const sp = scopeSpace(viewer, input.scope as string | undefined);
      const month = typeof input.month === "string" && /^\d{4}-\d{2}$/.test(input.month) ? input.month : currentMonth();
      const p = monthPeriod(month);
      const db = getDb();
      const accounts = db.select({ id: s.accounts.id, name: s.accounts.name }).from(s.accounts).where(eq(s.accounts.spaceId, sp.id)).all();
      const ids = accounts.map((a) => a.id);
      const limit = Math.min(25, Math.max(1, Number(input.limit) || 25));
      const rows = ids.length
        ? db.select().from(s.transactions).where(and(or(inArray(s.transactions.accountId, ids), inArray(s.transactions.counterAccountId, ids)), gte(s.transactions.date, p.from), lte(s.transactions.date, p.to), ...(typeof input.text === "string" && input.text ? [like(s.transactions.description, `%${input.text}%`)] : []))).orderBy(desc(s.transactions.date)).limit(limit).all()
        : [];
      const names = new Map(accounts.map((a) => [a.id, a.name]));
      const out = rows.map((t) => ({ id: t.id, date: t.date, description: t.description, amount: formatCents(t.amountCents, { cents: true }), kind: t.kind, account: names.get(t.accountId) ?? "account", voided: !!t.voidedAt, review: t.reviewStatus }));
      return { result: out, component: { kind: "transactions", title: `${sp.name} transactions, ${month}`, values: [], rows: out.map((r) => ({ label: `${r.date} · ${r.description}${r.voided ? " (void)" : ""}`, value: r.amount, note: r.kind.replace("_", " ") })) } };
    }
    case "get_upcoming_obligations": {
      const sp = scopeSpace(viewer, input.scope as string | undefined);
      const horizon = Math.min(90, Math.max(1, Number(input.horizon_days) || 30));
      const items = upcomingObligations(viewer, [sp.id], horizon);
      return { result: items, component: { kind: "obligations", title: `Upcoming in ${sp.name} (next ${horizon} days)`, values: [], rows: items.map((o) => ({ label: `${o.dueDate} · ${o.label}`, value: isKnown(o.amount) ? formatCents(o.amount.cents) : "unknown", note: `${o.paid ? "paid" : "due"} · paid by ${o.payer}`, status: o.paid ? "known" : "attention" })) } };
    }
    case "get_subscription_plan": {
      const company = viewer.spaces.find((sp) => sp.kind === "company") ?? fail("You cannot see the company space.");
      const subs = getDb().select().from(s.subscriptions).where(and(eq(s.subscriptions.workspaceId, viewer.workspace.id), eq(s.subscriptions.spaceId, company.id))).all();
      const v = buildCompanyView(viewer);
      const rows = subs.map((sub) => {
        const m = subscriptionMonthly(toPlannedSubscription(sub));
        return { id: sub.id, provider: sub.provider, product: sub.product, tier: sub.tier ?? "to confirm", quantity: sub.quantity, kind: sub.kind, status: sub.status, unitPrice: sub.unitPriceCents === null ? "unknown" : formatCents(sub.unitPriceCents), monthly: isKnown(m) ? formatCents(m.cents) : "unknown", evidence: sub.evidence ?? "none", users: (JSON.parse(sub.usersJson) as string[]).map((id) => viewer.persons.find((p) => p.id === id)?.name ?? id) };
      });
      const apiLine = v.plan.lines.find((l) => l.id === "api-actual");
      return {
        result: { subscriptions: rows, knownMonthlyTotal: v.plan.subscriptionsTotal, apiUsageLastMonth: apiLine && isKnown(apiLine.amount) ? apiLine.amount.cents : null },
        component: { kind: "subscriptions", title: "AI tools and software", values: [{ id: "subs-total", label: "Confirmed monthly total", ...money(v.plan.subscriptionsTotal) }, ...(apiLine && isKnown(apiLine.amount) ? [{ id: "api-actual", label: "API usage, last month actual", value: formatCents(apiLine.amount.cents), status: "known" as const }] : [])], rows: rows.map((r) => ({ label: `${r.provider} ${r.product} × ${r.quantity} (${r.tier})`, value: r.monthly, note: `${r.kind.replace("_", " ")} · ${r.status} · evidence: ${r.evidence}`, status: r.monthly === "unknown" ? "unknown" : "known" })), missing: rows.filter((r) => r.monthly === "unknown").map((r) => `${r.provider} ${r.product}: tier and price`) },
      };
    }
    case "explain_metric": {
      const id = String(input.metric_id ?? "");
      const m = findMetric(viewer, id);
      if (!m) fail(`No metric called ${id}.`);
      return { result: m, component: { kind: "metric", title: m.label, values: [{ id, label: m.label, ...money(m.total) }], rows: [...m.provenance.inputs.map((i) => ({ label: i.label, value: i.value, note: i.source })), { label: "Formula", value: m.provenance.formula }], assumptions: [...m.provenance.assumptions, ...m.provenance.caveats], asOf, metricId: id } };
    }
    case "evaluate_purchase": {
      const sp = scopeSpace(viewer, input.scope as string | undefined);
      const amount = dollarsToCents(input.amount_dollars);
      const recurring = input.recurring === true;
      const offset = Math.max(0, Math.min(24, Number(input.month_offset) || 0));
      const view = buildSpaceView(viewer, sp.id);
      const baseline = scenarioBaseline(view);
      const r = evaluatePurchase(baseline, { name: String(input.name ?? "Purchase"), amountCents: amount, kind: recurring ? "recurring" : "one_time", recurringMonths: null, startMonthOffset: offset });
      const conditional = r.verdict === "unknown" || (view.kind === "company" && view.plan.unknownCosts.length > 0);
      const verdictLabel = { affordable: conditional ? "Conditionally affordable" : "Affordable on known figures", affordable_with_goal_cuts: "Affordable, but the plan slips", creates_shortfall: "Creates a shortfall", unknown: "Cannot tell yet" }[r.verdict];
      const values: ResultValue[] = [
        { id: "verdict", label: "Verdict", value: verdictLabel, status: r.verdict === "creates_shortfall" ? "attention" : conditional ? "estimate" : "known" },
        { id: "min-cash", label: "Lowest projected cash after", value: r.minCashAfterCents === null ? "Unknown" : formatCents(r.minCashAfterCents), status: r.minCashAfterCents === null ? "unknown" : r.minCashAfterCents < 0 ? "attention" : "known" },
        { id: "cash-change", label: "Cash change over 6 months", value: r.endingCashDeltaCents === null ? "Unknown" : formatCents(r.endingCashDeltaCents, { signed: true }), status: "known" },
      ];
      const missing = view.kind === "company" ? view.plan.unknownCosts : baseline.availableComplete ? [] : ["take-home or food target"];
      return { result: { verdict: r.verdict, conditional, notes: r.notes, missing, minCashAfter: r.minCashAfterCents, endingCashDelta: r.endingCashDeltaCents, scope: sp.name, purpose: input.purpose ?? "unresolved" }, component: { kind: "purchase_scenario", title: `${String(input.name)} · ${formatCents(amount)}${recurring ? " a month" : ""} · ${sp.name}`, values, rows: r.notes.map((n) => ({ label: "", value: n })), missing, assumptions: r.assumptions, scope: sp.kind, asOf } };
    }
    case "get_review_items": {
      const items = reviewItems(viewer.assumptions, { personId: viewer.person?.id ?? null, personNames: Object.fromEntries(viewer.persons.map((p) => [p.id, p.name])), visiblePersonIds: viewer.persons.map((p) => p.id), canSeeCompany: viewer.spaces.some((sp) => sp.kind === "company") });
      return { result: items, component: { kind: "review_items", title: "Setup and review queue", values: [], rows: items.map((i) => ({ label: i.label, value: i.blocks, note: i.where, status: i.severity === "attention" ? "attention" : "unknown" })) } };
    }
    case "get_partner_summary": {
      const partner = viewer.persons.find((p) => p.id !== viewer.person?.id);
      if (!partner) fail("There is no partner in this workspace.");
      const sum = buildPartnerSummary(viewer, partner.id);
      if (!sum) fail("No summary available.");
      const statusLabel = { no_target: "no food target set", on_track: "on track", close: "close to the target", over: "over the target", not_shared: "not shared" }[sum.foodStatus];
      return { result: sum, component: { kind: "partner_summary", title: `${sum.name}'s summary (${sum.shared ? "aggregate only" : "not shared"})`, values: [{ id: "food", label: "Food this month", value: statusLabel, status: sum.foodStatus === "over" ? "attention" : "known" }, { id: "take-home", label: "Take-home", value: sum.takeHomeStatus.replace("_", " "), status: sum.takeHomeStatus === "verified" ? "known" : "estimate" }, ...(sum.savingsAllocationRoundedCents !== null ? [{ id: "savings", label: "Savings allocation (rounded)", value: `about ${formatCents(sum.savingsAllocationRoundedCents)}`, status: "known" as const }] : [])], rows: [{ label: "Privacy", value: "Individual purchases, merchants, dates and receipts are never shared." }] } };
    }
    case "draft_budget_change": {
      const me = viewer.person ?? fail("No person record.");
      const field = input.field === "allocation" ? "allocation" : "foodTarget";
      const draft = draftAction(viewer, "budget_change", { personId: me.id, field, amountCents: dollarsToCents(input.amount_dollars), allocation: field === "allocation" ? { name: String(input.allocation_name ?? "Allocation"), kind: (input.allocation_kind as "savings" | "investment" | "spending") ?? "spending" } : undefined });
      return { result: { actionId: draft.id, preview: draft.preview }, draft, component: previewComponent(draft) };
    }
    case "draft_expense": {
      const sp = scopeSpace(viewer, input.scope as string | undefined);
      const accounts = getDb().select().from(s.accounts).where(and(eq(s.accounts.spaceId, sp.id), eq(s.accounts.isArchived, false))).all();
      const account = accounts.find((a) => a.type === "credit_card") ?? accounts[0] ?? fail(`No account in ${sp.name} to record against.`);
      const amount = dollarsToCents(input.amount_dollars);
      const partner = viewer.persons.find((p) => p.id !== viewer.person?.id);
      const split = input.split_equally_with_partner === true && partner && viewer.person;
      const draft = draftAction(viewer, "expense", {
        spaceId: sp.id,
        accountId: account.id,
        date: typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : todayIso(),
        amountCents: amount,
        description: String(input.description),
        categoryName: typeof input.category === "string" && input.category ? input.category : "Food & dining",
        purpose: (input.purpose as string) ?? (sp.kind === "company" ? "unresolved" : "personal"),
        beneficiary: split ? "split" : sp.kind === "company" ? ((input.beneficiary as string) ?? "company") : sp.kind === "household" ? "household" : "person",
        payerPersonId: viewer.person?.id ?? null,
        shares: split ? [{ personId: viewer.person!.id, cents: Math.ceil(amount / 2) }, { personId: partner!.id, cents: Math.floor(amount / 2) }] : undefined,
        documentId: typeof input.document_id === "string" ? input.document_id : null,
      });
      return { result: { actionId: draft.id, preview: draft.preview }, draft, component: previewComponent(draft) };
    }
    case "draft_purchase_plan": {
      const sp = scopeSpace(viewer, (input.scope as string | undefined) ?? "company");
      const draft = draftAction(viewer, "purchase_plan", {
        name: String(input.name),
        category: (input.category as string) ?? "other",
        unitPriceCents: input.amount_dollars === undefined ? null : dollarsToCents(input.amount_dollars),
        quantity: 1,
        targetMonth: typeof input.target_month === "string" && /^\d{4}-\d{2}$/.test(input.target_month) ? input.target_month : null,
        payerSpaceId: sp.id,
        beneficiary: (input.beneficiary as string) ?? (sp.kind === "company" ? "company" : sp.kind === "household" ? "household" : "person"),
        purpose: (input.purpose as string) ?? (sp.kind === "company" ? "unresolved" : "personal"),
        notes: typeof input.notes === "string" ? input.notes : undefined,
      });
      return { result: { actionId: draft.id, preview: draft.preview }, draft, component: previewComponent(draft) };
    }
    case "draft_subscription_change": {
      const draft = draftAction(viewer, "subscription_change", {
        id: typeof input.subscription_id === "string" ? input.subscription_id : undefined,
        provider: String(input.provider),
        product: String(input.product),
        tier: typeof input.tier === "string" ? input.tier : null,
        quantity: Number(input.quantity) || 1,
        unitPriceCents: input.unit_price_dollars === undefined ? null : dollarsToCents(input.unit_price_dollars),
        interval: (input.interval as string) ?? "monthly",
        status: (input.status as string) ?? "planned",
      });
      return { result: { actionId: draft.id, preview: draft.preview }, draft, component: previewComponent(draft) };
    }
    default:
      fail(`Unknown tool ${name}`);
  }
}

function personalComponent(v: ReturnType<typeof buildPersonalView>): ResultComponent {
  const f = v.food;
  const th = v.takeHome;
  const values: ResultValue[] = [
    { id: "gross", label: "Gross salary", value: isKnown(th.gross) ? formatCents(th.gross.cents) : "Unknown", status: "known", note: "Not spendable cash." },
    { id: `${v.personId}-take-home`, label: th.status === "verified" ? "Take-home" : th.status === "estimate" ? "Take-home estimate" : "Take-home before income tax", value: th.takeHome.complete ? formatCents(th.takeHome.knownCents) : formatCents(th.beforeIncomeTax.knownCents), status: th.status === "verified" ? "known" : th.status === "estimate" ? "estimate" : "unknown", note: th.status === "incomplete" ? "income-tax withholding not confirmed" : th.status === "estimate" ? "not a verified paycheck" : undefined },
    { id: "food-target", label: "Food target", value: f.foodTarget === null ? "Not set" : formatCents(f.foodTarget), status: f.foodTarget === null ? "attention" : "known" },
    { id: "food-spent", label: "Food spent this month", value: formatCents(f.foodSpentCents), status: "known" },
    { id: "food-remaining", label: "Food remaining", value: f.foodRemainingCents === null ? "—" : formatCents(f.foodRemainingCents), status: f.foodStatus === "over" ? "attention" : f.foodRemainingCents === null ? "unknown" : "known" },
    { id: `${v.personId}-unallocated`, label: "Unallocated plan", ...money(f.unallocated.total) },
  ];
  return { kind: "food_plan", title: `${v.personName} · ${v.month}`, scope: "me", asOf: todayIso(), values, missing: [...th.takeHome.unknowns, ...(f.foodTarget === null ? ["Food target not set"] : [])], assumptions: th.assumptions, metricId: `${v.personId}-take-home` };
}

function previewComponent(draft: ActionView): ResultComponent {
  return { kind: draft.type === "expense" || draft.type === "food_split" ? "receipt_draft" : "plan_change", title: draft.preview.title, values: [], rows: draft.preview.rows.map((r) => ({ label: r.label, value: r.before !== null ? `${r.before} → ${r.after}` : r.after, note: r.note })), actionId: draft.id, missing: draft.preview.warnings, assumptions: draft.preview.boundaries };
}

/** Metrics the model or the UI can explain. Only metrics in the viewer's visible scopes. */
export function findMetric(viewer: Viewer, id: string) {
  const mine = mySpace(viewer);
  if (mine) {
    const v = buildPersonalView(viewer, mine.id);
    if (id === v.food.takeHome.id) return v.food.takeHome;
    if (id === v.food.unallocated.id) return v.food.unallocated;
  }
  if (viewer.spaces.some((sp) => sp.kind === "company")) {
    const c = buildCompanyView(viewer).plan;
    for (const m of [c.recordedCash, c.expectedReceipts, c.receivedSoFar, c.knownCommitments, c.partialRemainder]) if (m.id === id) return m;
  }
  if (viewer.spaces.some((sp) => sp.kind === "household")) {
    const h = buildHouseholdView(viewer);
    void h;
  }
  return null;
}

export function formatTotalSafe(t: Total): string {
  return formatTotal(t);
}

export { AuthorizationError };
