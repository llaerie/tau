/**
 * CfoOrchestrator — the single entry point. Routes a request to the right specialist
 * (explicit targetAgent → task-kind owner → best canHandle score), runs its own CFO-level tasks
 * (health, weekly brief, attention, concepts, setup status), and handles multi-agent workflows
 * such as "how are we doing" by merging controller + treasury + AR + auditor into one response.
 * The auditor's integrity verdict wins when it conflicts with a specialist's claim, and a RED
 * action can never surface as executed.
 */
import type { Agent, AgentRequest, AgentResponse, Escalation, ExecutiveResponse, SourceRef, ToolContext } from "@/lib/core/contracts";
import type { AgentAction, AgentName, Assumption, CalcResult, ISODate, ProposedAction, ToolCallRecord } from "@/lib/core/types";
import { fingerprint } from "@/lib/core/ids";
import { PROMPT_VERSION } from "@/lib/models/prompt-versions";
import { AGENT_WORKFLOW_VERSION, BaseAgent } from "./base-agent";
import { detectControlViolation } from "./guards";
import { routeByRules, type RouteRule } from "./intent";
import { composeExecutiveResponse, formatExecutiveResponse } from "./response";
import { agentForTask, isTaskKind } from "./task-catalog";
import { attentionQueueTool, configStatusTool, explainConceptTool, healthSummaryTool, weeklyBriefTool } from "./tools/cfo-tools";
import type { RouterResult } from "./types";

export const SPECIALIST_ORDER: AgentName[] = ["controller", "bookkeeping", "treasury", "fpa", "ap", "ar", "payroll", "tax", "documents", "strategy", "auditor"];

const HEALTH_RE = /\b(financial health|how (are|is) (we|the (business|company)) doing|how('s| is) (business|the company)|overall (picture|position|status)|state of the (business|company|finances)|health (check|summary)|where do we stand|big picture)\b/i;

const rules: RouteRule[] = [
  { kind: "cfo.weekly_brief", weight: 3.6, any: [/\bweekly brief\b/i, /\bbrief me\b/i, /\b(this|the) week'?s? (brief|summary|update)\b/i, /\bmonday (brief|update)\b/i, /\bcfo brief\w*\b/i], params: (_m, e) => ({ asOf: e.dates[0] }) },
  { kind: "cfo.attention", weight: 3.6, any: [/\battention\b/i, /\bwhat should i (look at|worry about|focus on)\b/i, /\balerts?\b/i, /\banomal/i, /\banything (urgent|wrong|to worry about)\b/i, /\bwhat('s| is) (urgent|pending|outstanding) (today|now)\b/i], params: (_m, e) => ({ asOf: e.dates[0] }) },
  { kind: "cfo.config_status", weight: 3.6, any: [/\b(finance )?setup\b/i, /\bconfig(uration)? status\b/i, /\bwhat('s| is) (still )?unknown\b/i, /\bmissing information\b/i, /\bunconfirmed (items|facts|fields)\b/i, /\bwhat (do you|does the system) (still )?need from me\b/i, /\bfinance bible\b/i], params: () => ({}) },
  { kind: "cfo.health", weight: 3.6, any: [HEALTH_RE], params: (_m, e) => ({ asOf: e.dates[0] }) },
  { kind: "cfo.explain_concept", weight: 2.4, any: [/\bwhat (is|are|does) (a |an |the )?([\w\s-]{3,40}?) ?(mean|\?|$)/i, /\bexplain (what|the concept of|the difference between|the term)\b/i, /\bdefine\b/i, /\bwhat('s| is) the difference between\b/i], none: [/\b(our|we|the company|my)\b/i], params: (m) => ({ concept: (/\b(?:what (?:is|are|does)|explain(?: the concept of| what| the term)?|define)\s+(?:a |an |the )?([\w\s-]{3,40}?)(?:\s+mean)?\s*\??$/i.exec(m)?.[1] ?? m).trim() }) },
];

export class CfoOrchestrator extends BaseAgent {
  readonly name: AgentName = "cfo_orchestrator";
  readonly description = "CFO orchestrator: routes every request to the right specialist, runs the weekly brief, attention queue, health summary, concept explanations and setup status, and merges multi-agent workflows.";
  protected readonly keywords: RegExp[] = [/\bhealth\b/i, /\bbrief\b/i, /\battention\b/i, /\bsetup\b/i, /\bexplain\b/i, /\bhow are we\b/i];
  private readonly specialists: Map<AgentName, Agent>;

  constructor(specialists: Record<string, Agent>) {
    super();
    this.specialists = new Map(Object.values(specialists).filter((a) => a.name !== "cfo_orchestrator").map((a) => [a.name, a]));
    this.registerTool(healthSummaryTool, "cfo.health");
    this.registerTool(explainConceptTool, "cfo.explain_concept");
    this.registerTool(configStatusTool, "cfo.config_status");
    this.registerTool(weeklyBriefTool, "cfo.weekly_brief");
    this.registerTool(attentionQueueTool, "cfo.attention");
  }

  protected route(message: string, asOf?: ISODate): RouterResult | null {
    return routeByRules(rules, message, asOf);
  }

  canHandle(): number {
    return 1;
  }

  specialist(name: AgentName): Agent | undefined {
    return this.specialists.get(name);
  }

  /** Decide who handles the request: explicit target → task owner → best score → self → null. */
  pickAgent(req: AgentRequest, asOf?: ISODate): { agent: Agent; reason: string; scores: Record<string, number> } | null {
    const scores: Record<string, number> = {};
    if (req.targetAgent) {
      if (req.targetAgent === this.name) return { agent: this, reason: "targetAgent", scores };
      const a = this.specialists.get(req.targetAgent);
      return a ? { agent: a, reason: "targetAgent", scores } : null;
    }
    if (req.task) {
      if (!isTaskKind(req.task.kind)) return null;
      const owner = agentForTask(req.task.kind);
      if (owner === this.name) return { agent: this, reason: "task-owner", scores };
      const a = this.specialists.get(owner);
      return a ? { agent: a, reason: "task-owner", scores } : null;
    }
    const own = this.route(req.message, asOf);
    let best: { agent: Agent; score: number } | null = null;
    for (const name of SPECIALIST_ORDER) {
      const a = this.specialists.get(name);
      if (!a) continue;
      const s = a.canHandle({ ...req, asOfDate: req.asOfDate ?? asOf });
      scores[name] = Math.round(s * 1000) / 1000;
      if (s > 0 && (!best || s > best.score + 1e-9)) best = { agent: a, score: s };
    }
    if (own && (own.confidence >= 0.9 || !best || best.score < 0.6)) return { agent: this, reason: `self:${own.kind}`, scores };
    if (best && best.score >= 0.5) return { agent: best.agent, reason: `score:${best.score.toFixed(2)}`, scores };
    if (own) return { agent: this, reason: `self:${own.kind}`, scores };
    return null;
  }

  async handle(req: AgentRequest, ctx: ToolContext): Promise<AgentResponse> {
    const asOf = req.asOfDate ?? ctx.asOfDate;
    const kind = req.task?.kind ?? this.route(req.message, asOf)?.kind;
    const violation = detectControlViolation(req.message, kind, req.task?.params);
    if (violation) return super.handle(req, ctx); // refused by the base pipeline before any routing/tool
    const pick = this.pickAgent(req, asOf);
    if (pick && pick.agent !== this) {
      const res = await pick.agent.handle({ ...req, targetAgent: pick.agent.name }, ctx);
      this.assertNoRedExecuted(res.agentActions);
      return { ...res, delegatedTo: [pick.agent.name], structured: { ...res.structured, routedBy: "cfo_orchestrator", routingReason: pick.reason, routingScores: pick.scores } };
    }
    if (kind === "cfo.health" || (!req.task && HEALTH_RE.test(req.message))) return this.handleHealth(req, ctx);
    return super.handle(req, ctx);
  }

  private assertNoRedExecuted(actions: AgentAction[]): void {
    const bad = actions.filter((a) => a.risk.level === "RED" && a.status === "EXECUTED");
    if (bad.length) throw new Error(`Control violation: RED action(s) reported as executed: ${bad.map((a) => a.action.kind).join(", ")}`);
  }

  /** Multi-agent financial health: controller statements + treasury cash + AR aging + auditor integrity, merged. */
  private async handleHealth(req: AgentRequest, baseCtx: ToolContext): Promise<AgentResponse> {
    const started = Date.now();
    const ctx: ToolContext = { ...baseCtx, agent: this.name, actor: req.actor ?? baseCtx.actor, asOfDate: req.asOfDate ?? baseCtx.asOfDate };
    const asOf = (req.task?.params?.asOf as string | undefined) ?? ctx.asOfDate;
    const year = asOf.slice(0, 4);
    const sub = async (name: AgentName, task: { kind: string; params?: Record<string, unknown> }) => {
      const a = this.specialists.get(name);
      if (!a) return null;
      return a.handle({ message: req.message, task, actor: ctx.actor, asOfDate: asOf, targetAgent: name }, ctx);
    };
    const [controller, treasury, ar, auditor] = await Promise.all([
      sub("controller", { kind: "accounting.financial_statements", params: { from: `${year}-01-01`, to: asOf } }),
      sub("treasury", { kind: "cash.position", params: { asOf } }),
      sub("ar", { kind: "ar.aging", params: { asOf } }),
      sub("auditor", { kind: "accounting.integrity_check", params: { asOf } }),
    ]);
    const parts = [controller, treasury, ar, auditor].filter((r): r is AgentResponse => Boolean(r));
    for (const p of parts) this.assertNoRedExecuted(p.agentActions);
    // Own summary tool (cash / runway / unknowns)
    const t0 = Date.now();
    const summary = await healthSummaryTool.execute({ asOf }, ctx);
    const toolCalls: ToolCallRecord[] = [{ name: healthSummaryTool.name, inputHash: fingerprint({ asOf }), outputHash: fingerprint(summary.ok ? (summary.data ?? null) : { error: summary.error }), riskLevel: "GREEN", durationMs: Date.now() - t0, ok: summary.ok, error: summary.error }, ...parts.flatMap((p) => p.toolCalls)];
    const calcs: CalcResult[] = [...(summary.calcs ?? [])];
    for (const p of parts) for (const c of p.calculations) if (!calcs.some((x) => x.id === c.id)) calcs.push(c);
    const assumptions: Assumption[] = [...(summary.assumptions ?? []), ...parts.flatMap((p) => p.assumptions)];
    const sources = new Map<string, SourceRef>();
    for (const p of parts) for (const s of p.sources) sources.set(s.id, s);
    const proposed: ProposedAction[] = parts.flatMap((p) => p.proposedActions);
    const agentActions: AgentAction[] = parts.flatMap((p) => p.agentActions);

    // Reconcile conflicting conclusions: the auditor's integrity verdict wins.
    const risks: string[] = [];
    const auditorPassed = auditor?.structured.passed;
    const controllerBalanced = controller?.structured.balanced === true && controller?.structured.reconciled === true;
    if (auditor && auditorPassed === false && controllerBalanced) risks.push(`Discrepancy: the controller reports balanced statements but the auditor's independent integrity check fails (${String((auditor.structured.values as Record<string, unknown> | undefined)?.failed ?? "?")} check(s)); the auditor's result is preferred until resolved.`);
    if (auditor && auditorPassed === true && controller && !controllerBalanced) risks.push("Discrepancy: the controller's statements do not balance while the auditor's isolated recomputation passes; treat the live ledger as suspect and rerun the statements.");
    for (const p of parts) for (const r of p.response.risks) if (!risks.includes(r)) risks.push(r);
    const escalation: Escalation | undefined = parts.map((p) => p.escalation).find((e) => e && e.type !== "OUT_OF_SCOPE");
    const pres = summary.data?.presentation;
    const numbers = [...(pres?.numbers ?? [])];
    for (const p of parts) for (const n of p.response.numbers) if (!numbers.some((x) => x.label === n.label)) numbers.push(n);
    const why = [...(pres?.why ?? []), ...parts.map((p) => `${p.agent}: ${p.response.answer}`)];
    const answer = `${pres?.answer ?? "Financial health summary."} Ledger integrity (auditor): ${auditorPassed === true ? "clean" : auditorPassed === false ? "ISSUES FOUND" : "not verified"}.`;
    let response: ExecutiveResponse = composeExecutiveResponse({
      presentation: { answer, numbers: numbers.slice(0, 16), why, risks, recommendation: pres?.recommendation ?? (risks.length ? "Address the flagged items." : "No urgent issues."), educationKey: "cash_vs_profit" },
      calcs,
      assumptions,
      sources: [...sources.values()],
      needsApproval: parts.flatMap((p) => p.response.needsApproval),
      escalation,
      agentActions,
    });
    const values: Record<string, unknown> = {};
    for (const p of parts) Object.assign(values, (p.structured.values as Record<string, unknown> | undefined) ?? {});
    Object.assign(values, ((pres?.structured?.values as Record<string, unknown> | undefined) ?? {}));
    const delegatedTo = parts.map((p) => p.agent);
    const structured: Record<string, unknown> = {
      task: "cfo.health",
      agent: this.name,
      via: req.task ? "TASK" : "ROUTER",
      delegatedTo,
      value: pres?.structured?.value ?? null,
      values,
      integrityPassed: auditorPassed ?? null,
      discrepancies: risks.filter((r) => r.startsWith("Discrepancy")),
      escalation: escalation?.type ?? null,
      riskLevel: agentActions.length ? agentActions.map((a) => a.risk.level).includes("RED") ? "RED" : agentActions.map((a) => a.risk.level).includes("YELLOW") ? "YELLOW" : "GREEN" : "GREEN",
      actionsExecuted: agentActions.filter((a) => a.status === "EXECUTED").length,
      requiresApproval: response.needsApproval.length > 0,
      needsApproval: response.needsApproval.map((n) => n.actionId),
      sourceLayers: ["COMPANY"],
      toolsCalled: toolCalls.map((t) => t.name),
      calculationIds: calcs.map((c) => c.id),
      parts: Object.fromEntries(parts.map((p) => [p.agent, { intent: p.intent, escalation: p.escalation?.type ?? null, auditEventId: p.auditEventId }])),
    };
    response.highRisk = undefined;
    structured.rendered = formatExecutiveResponse(response);
    const confidence = parts.length ? Math.round((parts.reduce((a, p) => a + p.confidence, 0) / parts.length) * 100) / 100 : 0.5;
    structured.confidence = confidence;
    const auditEvent = await ctx.audit.record({
      actor: ctx.actor,
      agent: this.name,
      model: ctx.models.reasoning.info,
      workflowVersion: AGENT_WORKFLOW_VERSION,
      promptVersion: PROMPT_VERSION,
      eventType: "AGENT_REQUEST",
      toolsCalled: toolCalls,
      calculationIds: calcs.map((c) => c.id),
      approvalIds: agentActions.map((a) => a.approvalId).filter((x): x is string => Boolean(x)),
      confidence,
      finalAction: escalation ? `ESCALATION:${escalation.type}` : "ANSWERED",
      explanation: [`cfo_orchestrator merged financial health from ${delegatedTo.join(", ")} (sub audit events ${parts.map((p) => p.auditEventId).join(", ")}).`, `Answer: ${answer.slice(0, 240)}`, ...(risks.filter((r) => r.startsWith("Discrepancy")).map((r) => `Reconciled: ${r}`))].join("\n"),
      afterState: { task: "cfo.health", delegatedTo, integrityPassed: auditorPassed ?? null },
    });
    response = { ...response };
    return {
      agent: this.name,
      delegatedTo,
      intent: "cfo.health",
      response,
      toolCalls,
      calculations: calcs,
      sources: [...sources.values()],
      assumptions,
      escalation,
      proposedActions: proposed,
      agentActions,
      confidence,
      auditEventId: auditEvent.id,
      model: ctx.models.reasoning.info,
      structured,
      durationMs: Date.now() - started,
    };
  }
}
