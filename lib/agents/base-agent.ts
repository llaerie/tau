/**
 * BaseAgent — the shared pipeline every specialist (and the orchestrator) runs:
 *   (a) resolve task (structured task validated, or deterministic NL router)
 *   (b) permission check (RBAC)
 *   (c) control guard — before any tool runs
 *   (d) execute mapped tool(s); every call recorded with hashes + duration
 *   (e) governance for proposed actions (risk → execute / approval / blocked)
 *   (f) compose the mandatory ExecutiveResponse
 *   (g) high-risk FACT / CALCULATION / ASSUMPTION / PROFESSIONAL JUDGMENT separation
 *   (h) optional model narrative with numeric guard
 *   (i) audit event
 *   (j) structured payload following task-catalog conventions
 */
import { ZodError } from "zod";
import type { Agent, AgentRequest, AgentResponse, Escalation, ExecutiveResponse, SourceRef, ToolContext, ToolResult } from "@/lib/core/contracts";
import type { AgentName, Assumption, CalcResult, ID, ISODate, ProposedAction, RiskLevel, ToolCallRecord } from "@/lib/core/types";
import { fingerprint } from "@/lib/core/ids";
import { can, type Permission } from "@/lib/security/rbac";
import { redactForRole } from "@/lib/security/redaction";
import { PROMPT_VERSION } from "@/lib/models/prompt-versions";
import { detectControlViolation, escalationForViolation, type ControlViolation } from "./guards";
import { governProposedActions, maxRisk, type GovernanceOutcome } from "./governance";
import { keywordScore } from "./intent";
import { isolateForVerification } from "./isolation";
import { maybeRewriteNarrative } from "./narrative";
import { composeExecutiveResponse, defaultHighRiskBreakdown, educationKeyForTask, formatExecutiveResponse } from "./response";
import { TASKS, agentForTask, capabilityForTask, isTaskKind, parseTaskParams, type TaskKind } from "./task-catalog";
import type { AgentTool, Presentation, RouterResult, TaskResolution, ToolData, ToolRun } from "./types";

export const AGENT_WORKFLOW_VERSION = "agents:v1";

export interface TaskHandlerArgs {
  kind: TaskKind;
  params: Record<string, unknown>;
  ctx: ToolContext;
  req: AgentRequest;
  run: <I>(tool: AgentTool<I>, input: I) => Promise<ToolResult<ToolData>>;
}
export type TaskHandler = (args: TaskHandlerArgs) => Promise<ToolResult<ToolData>>;

/** Tasks that propose or execute actions: the actor needs PROPOSE_ACTIONS before any tool runs. */
export const ACTION_TASK_PERMISSIONS: Partial<Record<TaskKind, Permission>> = {
  "accounting.journal_entry_draft": "PROPOSE_ACTIONS",
  "accounting.post_journal_entry": "PROPOSE_ACTIONS",
  "accounting.correcting_entry": "PROPOSE_ACTIONS",
  "accounting.close_period": "PROPOSE_ACTIONS",
  "accounting.modify_closed_period": "PROPOSE_ACTIONS",
  "ap.bill_intake": "PROPOSE_ACTIONS",
  "ap.pay_bill": "PROPOSE_ACTIONS",
  "ap.vendor_create": "PROPOSE_ACTIONS",
  "ar.create_invoice": "PROPOSE_ACTIONS",
  "ar.match_payment": "PROPOSE_ACTIONS",
  "ar.collection_reminder": "PROPOSE_ACTIONS",
  "payroll.change": "PROPOSE_ACTIONS",
  "tax.file_return": "PROPOSE_ACTIONS",
};

/** Task kinds whose answers must carry the high-risk breakdown. */
export const HIGH_RISK_TASKS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  "tax.calendar", "tax.calculate_with_rule", "tax.question", "tax.workpaper", "tax.document_checklist", "tax.cpa_package", "tax.file_return", "tax.shareholder_summary",
  "payroll.calendar", "payroll.reconcile_run", "payroll.employer_cost", "payroll.gross_to_net", "payroll.liabilities", "payroll.classification_flag", "payroll.international_review", "payroll.change", "payroll.owner_compensation",
  "accounting.modify_closed_period", "fpa.headcount_plan", "strategy.hiring_case",
]);
const HIGH_RISK_MESSAGE = /\b(tax(es)?|payroll|owner('s)?\s+(comp\w*|salary|pay|draw)|reasonable\s+comp\w*|related[\s-]party|international|china|chinese|overseas|entity|s[\s-]?corp\w*|llc|accounting\s+(policy|method)|distribution|shareholder|1099|w-?2|withholding|deduct\w*)\b/i;

function sourceKindFor(id: ID): SourceRef["kind"] {
  const p = id.split("_")[0];
  switch (p) {
    case "doc": return "DOCUMENT";
    case "tx": return "TRANSACTION";
    case "je": return "JOURNAL_ENTRY";
    case "calc": return "CALCULATION";
    case "src": return "KNOWLEDGE";
    case "rule": return "TAX_RULE";
    case "pol": return "POLICY";
    case "guid": return "GUIDANCE";
    case "cfg": return "CONFIG";
    default: return "OTHER";
  }
}

export abstract class BaseAgent implements Agent {
  abstract readonly name: AgentName;
  abstract readonly description: string;
  readonly tools: AgentTool[] = [];
  protected readonly taskTools = new Map<TaskKind, AgentTool>();
  protected readonly handlers = new Map<TaskKind, TaskHandler>();
  /** Keyword patterns used by canHandle(). */
  protected abstract readonly keywords: RegExp[];
  /** Deterministic NL router of this agent. */
  protected abstract route(message: string, asOf?: ISODate): RouterResult | null;

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  protected registerTool<I>(tool: AgentTool<I>, ...kinds: TaskKind[]): void {
    const t = tool as AgentTool;
    if (!this.tools.includes(t)) this.tools.push(t);
    for (const k of kinds) this.taskTools.set(k, t);
  }

  protected registerHandler(kind: TaskKind, handler: TaskHandler): void {
    this.handlers.set(kind, handler);
  }

  ownsTask(kind: string): boolean {
    if (!isTaskKind(kind)) return false;
    return this.taskTools.has(kind) || this.handlers.has(kind) || agentForTask(kind) === this.name;
  }

  taskKinds(): TaskKind[] {
    return [...new Set([...this.taskTools.keys(), ...this.handlers.keys()])];
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  canHandle(req: AgentRequest): number {
    if (req.targetAgent) return req.targetAgent === this.name ? 1 : 0;
    if (req.task) return this.ownsTask(req.task.kind) ? 1 : 0;
    const routed = this.route(req.message, req.asOfDate);
    const kw = keywordScore(req.message, this.keywords);
    if (!routed) return Math.min(0.45, kw * 0.5);
    return Math.min(1, routed.confidence * 0.7 + kw * 0.3 + 0.05);
  }

  protected resolveTask(req: AgentRequest, asOf?: ISODate): { resolution?: TaskResolution; escalation?: Escalation; answer?: string } {
    if (req.task) {
      const kind = req.task.kind;
      if (!isTaskKind(kind)) return { escalation: { type: "OUT_OF_SCOPE", message: `Unknown task kind "${kind}".` }, answer: `I don't have a task called "${kind}". Available kinds include: ${this.taskKinds().slice(0, 8).join(", ")}.` };
      try {
        const params = parseTaskParams(kind, req.task.params ?? {}) as Record<string, unknown>;
        return { resolution: { kind, params, via: "TASK", confidence: 1 } };
      } catch (err) {
        const issues = err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`) : [String(err)];
        return { escalation: { type: "INSUFFICIENT_INFORMATION", message: `Task ${kind} is missing or has invalid parameters.`, missingItems: issues }, answer: `I can run ${kind} once the parameters are valid: ${issues.join("; ")}.` };
      }
    }
    const routed = this.route(req.message, req.asOfDate ?? asOf);
    if (!routed) {
      return {
        escalation: { type: "OUT_OF_SCOPE", message: `The ${this.name} agent could not map this request to a supported task.` },
        answer: `I couldn't map that to a task I can run. ${this.description} Supported tasks: ${this.taskKinds().join(", ")}.`,
      };
    }
    try {
      const params = parseTaskParams(routed.kind, routed.params) as Record<string, unknown>;
      return { resolution: { kind: routed.kind, params, via: "ROUTER", confidence: routed.confidence } };
    } catch (err) {
      const issues = err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`) : [String(err)];
      return { escalation: { type: "INSUFFICIENT_INFORMATION", message: `I understood this as ${routed.kind} but some inputs are missing.`, missingItems: issues }, answer: `I understood this as "${TASKS[routed.kind].description}" but I need: ${issues.join("; ")}. I never substitute a guess for a missing input.` };
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline
  // ---------------------------------------------------------------------------

  async handle(req: AgentRequest, baseCtx: ToolContext): Promise<AgentResponse> {
    const started = Date.now();
    const ctx0: ToolContext = { ...baseCtx, agent: this.name, actor: req.actor ?? baseCtx.actor, asOfDate: req.asOfDate ?? baseCtx.asOfDate };
    const ctx = this.name === "auditor" ? isolateForVerification(ctx0) : ctx0;
    const runs: ToolRun[] = [];
    const toolCalls: ToolCallRecord[] = [];
    const calcs: CalcResult[] = [];
    const sources = new Map<ID, SourceRef>();
    const assumptions: Assumption[] = [];
    const proposed: ProposedAction[] = [];
    const auditNotes: string[] = [];

    const run = async <I>(tool: AgentTool<I>, input: I): Promise<ToolResult<ToolData>> => {
      const t0 = Date.now();
      let result: ToolResult<ToolData>;
      let parsedInput: I = input;
      try {
        parsedInput = tool.inputSchema.parse(input);
        result = await tool.execute(parsedInput, ctx);
      } catch (err) {
        const message = err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") : err instanceof Error ? err.message : String(err);
        result = { ok: false, error: message };
      }
      const durationMs = Date.now() - t0;
      runs.push({ name: tool.name, input: parsedInput, result, durationMs });
      toolCalls.push({ name: tool.name, inputHash: fingerprint(parsedInput ?? null), outputHash: fingerprint(result.ok ? (result.data ?? null) : { error: result.error }), riskLevel: tool.riskLevel, durationMs, ok: result.ok, error: result.error });
      for (const c of result.calcs ?? []) if (!calcs.some((x) => x.id === c.id)) calcs.push(c);
      for (const id of result.sourceIds ?? []) if (!sources.has(id)) sources.set(id, { id, kind: sourceKindFor(id), label: id });
      for (const s of result.data?.presentation?.sourceRefs ?? []) sources.set(s.id, s);
      for (const a of result.assumptions ?? []) if (!assumptions.some((x) => x.key === a.key && x.description === a.description)) assumptions.push(a);
      for (const p of result.proposedActions ?? []) proposed.push(p);
      return result;
    };

    // (a) resolve task ----------------------------------------------------------
    const resolved = this.resolveTask(req, ctx.asOfDate);
    const resolution: TaskResolution | undefined = resolved.resolution;
    let presentation: Presentation;
    let escalation: Escalation | undefined = resolved.escalation;
    let violation: ControlViolation | null = null;
    let governance: GovernanceOutcome = { agentActions: [], needsApproval: [], riskLevel: null, actionsExecuted: 0, approvalIds: [], permissionDenied: [] };
    let eventType = "AGENT_REQUEST";

    if (!resolution) {
      presentation = { answer: resolved.answer ?? "Request could not be resolved.", confidence: 0.3 };
      // A control violation is refused even when the task could not be resolved.
      violation = detectControlViolation(req.message);
    } else {
      // (b) permission ----------------------------------------------------------
      const needed: Permission[] = ["VIEW_FINANCIALS"];
      const actionPerm = ACTION_TASK_PERMISSIONS[resolution.kind];
      if (actionPerm) needed.push(actionPerm);
      if (resolution.kind.startsWith("payroll.") && resolution.kind !== "payroll.calendar") needed.push("VIEW_PAYROLL_DETAIL");
      const missingPerm = needed.filter((p) => !can(ctx.actor.role, p));
      // (c) control guard -------------------------------------------------------
      violation = detectControlViolation(req.message, resolution.kind, resolution.params);
      if (missingPerm.length && !violation) {
        eventType = "AGENT_PERMISSION_DENIED";
        escalation = { type: "REFUSED_CONTROL_VIOLATION", message: `Role ${ctx.actor.role} lacks ${missingPerm.join(", ")} required for ${resolution.kind}.`, requiredRole: missingPerm.includes("PROPOSE_ACTIONS") ? "FINANCE_OPERATOR" : "OWNER" };
        presentation = { answer: `I can't run ${resolution.kind} for a ${ctx.actor.role}: it requires ${missingPerm.join(" and ")}. No records were touched. Ask an owner or finance operator to submit this request.`, structured: { permissionDenied: true, missingPermissions: missingPerm }, confidence: 1 };
      } else if (!violation) {
        // (d) execute -------------------------------------------------------------
        presentation = await this.execute(resolution, req, ctx, run);
        // (e) governance ------------------------------------------------------------
        if (proposed.length) governance = await governProposedActions(proposed, ctx, capabilityForTask(resolution.kind));
        escalation = governance.escalation?.type === "REFUSED_CONTROL_VIOLATION" ? governance.escalation : presentation.escalation ?? governance.escalation;
      } else {
        presentation = { answer: "" };
      }
    }

    if (violation) {
      eventType = "AGENT_REFUSED_CONTROL_VIOLATION";
      escalation = escalationForViolation(violation);
      presentation = {
        answer: `I can't do that. ${violation.explanation} Control: ${violation.control} What I can do instead: ${violation.compliantAlternative}`,
        why: [`Detected: "${violation.matched}"`, violation.control],
        whatChanges: ["Nothing. No tool was run, no record was created or changed, and no money moved."],
        risks: ["Performing the requested action would misstate the books, breach a control, or expose the company to compliance risk."],
        recommendation: violation.compliantAlternative,
        structured: { controlViolation: violation.kind, compliantAlternative: violation.compliantAlternative },
        confidence: 0.95,
      };
      // tools never ran: guarantee nothing leaked in
      runs.length = 0;
      toolCalls.length = 0;
      proposed.length = 0;
    }

    // (f) compose ------------------------------------------------------------------
    const sourceList = [...sources.values()];
    const highRiskNeeded = Boolean(resolution && HIGH_RISK_TASKS.has(resolution.kind)) || HIGH_RISK_MESSAGE.test(req.message) || Boolean(presentation.highRisk);
    const educationKey = presentation.educationKey ?? (resolution ? educationKeyForTask(resolution.kind) : undefined);
    let response: ExecutiveResponse = composeExecutiveResponse({
      presentation: { ...presentation, educationKey, numbers: presentation.numbers },
      calcs,
      assumptions,
      sources: sourceList,
      needsApproval: governance.needsApproval,
      escalation,
      agentActions: governance.agentActions,
    });
    // (g) high-risk separation --------------------------------------------------------
    if (highRiskNeeded) {
      response.highRisk = presentation.highRisk ?? defaultHighRiskBreakdown({ numbers: response.numbers, calcs, assumptions, escalation, facts: presentation.structured?.facts as string[] | undefined, judgment: presentation.structured?.professionalJudgment as string[] | undefined });
    }

    // (j) structured (built before the narrative so the numeric guard can use it) -----
    const riskLevel: RiskLevel | null = governance.riskLevel ?? maxRisk(toolCalls.map((t) => t.riskLevel)) ?? (resolution ? "GREEN" : null);
    const scalarCalcs = calcs.filter((c) => c.value === null || typeof c.value !== "object");
    const values: Record<string, unknown> = {};
    for (const c of scalarCalcs) values[c.name] = c.value;
    const ps = presentation.structured ?? {};
    let structured: Record<string, unknown> = {
      task: resolution?.kind ?? null,
      agent: this.name,
      via: resolution?.via ?? null,
      ...ps,
      values: { ...values, ...((ps.values as Record<string, unknown> | undefined) ?? {}) },
      value: "value" in ps ? ps.value : scalarCalcs[0]?.value ?? null,
      escalation: escalation?.type ?? null,
      escalationMessage: escalation?.message ?? null,
      riskLevel,
      actionsExecuted: governance.actionsExecuted,
      requiresApproval: governance.needsApproval.length > 0,
      needsApproval: governance.needsApproval.map((n) => n.actionId),
      proposedActions: governance.agentActions.map((a) => ({ id: a.action.id, kind: a.action.kind, riskLevel: a.risk.level, status: a.status, approvalId: a.approvalId ?? null })),
      sourceLayers: presentation.sourceLayers ?? (calcs.length || sourceList.length ? ["COMPANY"] : []),
      toolsCalled: toolCalls.map((t) => t.name),
      calculationIds: calcs.map((c) => c.id),
    };
    if (response.highRisk) structured.highRisk = response.highRisk;
    if (!can(ctx.actor.role, "VIEW_PAYROLL_DETAIL") || !can(ctx.actor.role, "VIEW_SENSITIVE_IDENTIFIERS")) structured = redactForRole(structured, ctx.actor.role);

    // (h) optional model narrative with numeric guard ------------------------------------
    const narrative = await maybeRewriteNarrative(ctx, response, structured, calcs);
    response = narrative.response;
    if (narrative.note) auditNotes.push(narrative.note);
    structured.narrative = narrative.status;
    structured.rendered = formatExecutiveResponse(response);

    // confidence ---------------------------------------------------------------------------
    const base = presentation.confidence ?? (escalation ? 0.55 : 0.85);
    const confidence = Math.round(Math.min(1, Math.max(0, base * (resolution?.via === "ROUTER" ? 0.7 + 0.3 * resolution.confidence : 1))) * 100) / 100;
    structured.confidence = confidence;

    // (i) audit ----------------------------------------------------------------------------
    const auditEvent = await ctx.audit.record({
      actor: ctx.actor,
      agent: this.name,
      model: ctx.models.reasoning.info,
      workflowVersion: AGENT_WORKFLOW_VERSION,
      promptVersion: PROMPT_VERSION,
      eventType,
      toolsCalled: toolCalls,
      sourceDocumentIds: sourceList.filter((s) => s.kind === "DOCUMENT").map((s) => s.id),
      calculationIds: calcs.map((c) => c.id),
      approvalIds: governance.approvalIds,
      confidence,
      finalAction: escalation ? `ESCALATION:${escalation.type}` : governance.actionsExecuted ? `EXECUTED:${governance.actionsExecuted}` : "ANSWERED",
      explanation: [
        `${this.name} handled ${resolution ? `${resolution.kind} (${resolution.via}, routing confidence ${resolution.confidence.toFixed(2)})` : "an unresolved request"} for ${ctx.actor.role}.`,
        `Answer: ${response.answer.slice(0, 240)}`,
        escalation ? `Escalation ${escalation.type}: ${escalation.message}` : "No escalation.",
        toolCalls.length ? `Tools: ${toolCalls.map((t) => `${t.name}${t.ok ? "" : " (failed)"}`).join(", ")}` : "No tools executed.",
        ...auditNotes,
      ].join("\n"),
      afterState: { task: resolution?.kind ?? null, escalation: escalation?.type ?? null, actionsExecuted: governance.actionsExecuted, approvalIds: governance.approvalIds },
    });

    return {
      agent: this.name,
      intent: resolution?.kind ?? (violation ? `refused:${violation.kind}` : "unresolved"),
      response,
      toolCalls,
      calculations: calcs,
      sources: sourceList,
      assumptions,
      escalation,
      proposedActions: proposed,
      agentActions: governance.agentActions,
      confidence,
      auditEventId: auditEvent.id,
      model: ctx.models.reasoning.info,
      structured,
      durationMs: Date.now() - started,
    };
  }

  /** Execute the resolved task through the mapped tool or a custom handler. */
  protected async execute(resolution: TaskResolution, req: AgentRequest, ctx: ToolContext, run: TaskHandlerArgs["run"]): Promise<Presentation> {
    const handler = this.handlers.get(resolution.kind);
    const tool = this.taskTools.get(resolution.kind);
    let result: ToolResult<ToolData>;
    if (handler) result = await handler({ kind: resolution.kind, params: resolution.params, ctx, req, run });
    else if (tool) result = await run(tool, resolution.params);
    else return { answer: `The ${this.name} agent does not implement ${resolution.kind}.`, escalation: { type: "OUT_OF_SCOPE", message: `${resolution.kind} is not implemented by ${this.name}.` }, confidence: 0.2 };
    if (!result.ok) {
      const msg = result.error ?? "unknown error";
      const insufficient = /INSUFFICIENT|missing|unknown|not found|required/i.test(msg);
      return {
        answer: insufficient ? `I could not complete ${resolution.kind}: ${msg}. Nothing was assumed in its place.` : `${resolution.kind} failed safely: ${msg}. No records were changed.`,
        escalation: { type: insufficient ? "INSUFFICIENT_INFORMATION" : "OUT_OF_SCOPE", message: msg, missingItems: insufficient ? [msg] : undefined },
        confidence: 0.3,
        structured: { toolError: msg },
      };
    }
    return result.data?.presentation ?? { answer: `${resolution.kind} completed.`, structured: { data: result.data } };
  }
}
