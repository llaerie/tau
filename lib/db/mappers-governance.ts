/**
 * Domain ↔ row mapping for governance (approvals, agent actions, audit), knowledge, policy,
 * evaluation and calculations. Helpers come from ./mappers-helpers.
 */
import type { Prisma } from "@prisma/client";
import type * as PC from "@prisma/client";
import type {
  AgentAction,
  AgentName,
  ApprovalRequest,
  Assumption,
  AuditEvent,
  AutonomyLevel,
  CalcResult,
  CompetencyScore,
  EvalMetrics,
  EvaluationRecord,
  KnowledgeSource,
  ModelInfo,
  Policy,
  ProfessionalGuidance,
  ProposedAction,
  RiskAssessment,
  ToolCallRecord,
} from "@/lib/core/types";
import {
  compact,
  dateTimeToISO,
  dateTimeToISOOpt,
  dateToISO,
  dateToISOOpt,
  fromJson,
  fromJsonOpt,
  isoToDate,
  isoToDateOpt,
  isoToDateTime,
  isoToDateTimeOpt,
  nullable,
  optional,
  toJson,
  toJsonOpt,
} from "./mappers-helpers";

// ---------------------------------------------------------------------------
// Approvals & agent actions
// ---------------------------------------------------------------------------

export function toApprovalRequestRow(a: ApprovalRequest): Prisma.ApprovalRequestCreateManyInput {
  return {
    id: a.id,
    action: toJson(a.action),
    risk: toJson(a.risk),
    actionKind: a.action.kind,
    riskLevel: a.risk.level,
    requestedApproverRoles: a.requestedApproverRoles ?? [],
    status: a.status,
    requestedAt: isoToDateTime(a.requestedAt),
    decidedAt: isoToDateTimeOpt(a.decidedAt),
    decidedBy: nullable(a.decidedBy),
    decidedByRole: nullable(a.decidedByRole),
    decisionComment: nullable(a.decisionComment),
    expiresAt: isoToDateTimeOpt(a.expiresAt),
    auditEventIds: a.auditEventIds ?? [],
  };
}
export function fromApprovalRequestRow(r: PC.ApprovalRequest): ApprovalRequest {
  return compact({
    id: r.id,
    action: fromJson<ProposedAction>(r.action),
    risk: fromJson<RiskAssessment>(r.risk),
    requestedApproverRoles: r.requestedApproverRoles,
    status: r.status,
    requestedAt: dateTimeToISO(r.requestedAt),
    decidedAt: dateTimeToISOOpt(r.decidedAt),
    decidedBy: optional(r.decidedBy),
    decidedByRole: optional(r.decidedByRole),
    decisionComment: optional(r.decisionComment),
    expiresAt: dateTimeToISOOpt(r.expiresAt),
    auditEventIds: r.auditEventIds,
  });
}

export function toAgentActionRow(a: AgentAction): Prisma.AgentActionCreateManyInput {
  return {
    id: a.id,
    action: toJson(a.action),
    risk: toJson(a.risk),
    actionKind: a.action.kind,
    agent: a.action.agent,
    riskLevel: a.risk.level,
    status: a.status,
    approvalId: nullable(a.approvalId),
    auditEventId: nullable(a.auditEventId),
    executedAt: isoToDateTimeOpt(a.executedAt),
    result: toJsonOpt(a.result),
    blockedReason: nullable(a.blockedReason),
  };
}
export function fromAgentActionRow(r: PC.AgentAction): AgentAction {
  return compact({
    id: r.id,
    action: fromJson<ProposedAction>(r.action),
    risk: fromJson<RiskAssessment>(r.risk),
    status: r.status,
    approvalId: optional(r.approvalId),
    auditEventId: optional(r.auditEventId),
    executedAt: dateTimeToISOOpt(r.executedAt),
    result: fromJsonOpt<Record<string, unknown>>(r.result),
    blockedReason: optional(r.blockedReason),
  });
}

// ---------------------------------------------------------------------------
// Audit (append-only)
// ---------------------------------------------------------------------------

export function toAuditEventRow(e: AuditEvent): Prisma.AuditEventCreateManyInput {
  return {
    id: e.id,
    seq: e.seq,
    timestamp: isoToDateTime(e.timestamp),
    actorType: e.actor.type,
    actorId: e.actor.id,
    actorRole: e.actor.role,
    actorDisplayName: nullable(e.actor.displayName),
    agent: nullable(e.agent),
    model: toJsonOpt(e.model),
    workflowVersion: e.workflowVersion,
    promptVersion: nullable(e.promptVersion),
    eventType: e.eventType,
    toolsCalled: toJson(e.toolsCalled ?? []),
    sourceDocumentIds: e.sourceDocumentIds ?? [],
    calculationIds: e.calculationIds ?? [],
    proposedActionId: nullable(e.proposedActionId),
    finalAction: nullable(e.finalAction),
    approvalIds: e.approvalIds ?? [],
    confidence: nullable(e.confidence),
    explanation: e.explanation,
    beforeState: toJsonOpt(e.beforeState),
    afterState: toJsonOpt(e.afterState),
    previousHash: e.previousHash,
    hash: e.hash,
  };
}
export function fromAuditEventRow(r: PC.AuditEvent): AuditEvent {
  return compact({
    id: r.id,
    seq: r.seq,
    timestamp: dateTimeToISO(r.timestamp),
    actor: compact({
      type: r.actorType,
      id: r.actorId,
      role: r.actorRole,
      displayName: optional(r.actorDisplayName),
    }),
    agent: optional(r.agent) as AgentName | undefined,
    model: fromJsonOpt<ModelInfo>(r.model),
    workflowVersion: r.workflowVersion,
    promptVersion: optional(r.promptVersion),
    eventType: r.eventType,
    toolsCalled: fromJson<ToolCallRecord[]>(r.toolsCalled),
    sourceDocumentIds: r.sourceDocumentIds,
    calculationIds: r.calculationIds,
    proposedActionId: optional(r.proposedActionId),
    finalAction: optional(r.finalAction),
    approvalIds: r.approvalIds,
    confidence: optional(r.confidence),
    explanation: r.explanation,
    beforeState: fromJsonOpt<Record<string, unknown>>(r.beforeState),
    afterState: fromJsonOpt<Record<string, unknown>>(r.afterState),
    previousHash: r.previousHash,
    hash: r.hash,
  });
}

// ---------------------------------------------------------------------------
// Policy, knowledge, guidance
// ---------------------------------------------------------------------------

export function toPolicyRow(p: Policy): Prisma.PolicyCreateManyInput {
  return {
    id: p.id,
    key: p.key,
    title: p.title,
    body: p.body,
    version: p.version,
    status: p.status,
    effectiveDate: isoToDate(p.effectiveDate),
    approvedBy: nullable(p.approvedBy),
    sourceGuidanceId: nullable(p.sourceGuidanceId),
    parameters: toJsonOpt(p.parameters),
  };
}
export function fromPolicyRow(r: PC.Policy): Policy {
  return compact({
    id: r.id,
    key: r.key,
    title: r.title,
    body: r.body,
    version: r.version,
    status: r.status,
    effectiveDate: dateToISO(r.effectiveDate),
    approvedBy: optional(r.approvedBy),
    sourceGuidanceId: optional(r.sourceGuidanceId),
    parameters: fromJsonOpt<Record<string, unknown>>(r.parameters),
  });
}

export function toKnowledgeSourceRow(k: KnowledgeSource): Prisma.KnowledgeSourceCreateManyInput {
  return {
    id: k.id,
    layer: k.layer,
    title: k.title,
    url: nullable(k.url),
    publisher: nullable(k.publisher),
    jurisdiction: nullable(k.jurisdiction),
    effectiveDate: isoToDateOpt(k.effectiveDate),
    retrievedAt: isoToDateTimeOpt(k.retrievedAt),
    taxYear: nullable(k.taxYear),
    excerpt: k.excerpt,
    normalizedRule: nullable(k.normalizedRule),
    confidence: k.confidence,
    reviewBy: isoToDateOpt(k.reviewBy),
    status: k.status,
    tags: k.tags ?? [],
    contentHash: nullable(k.contentHash),
  };
}
export function fromKnowledgeSourceRow(r: PC.KnowledgeSource): KnowledgeSource {
  return compact({
    id: r.id,
    layer: r.layer,
    title: r.title,
    url: optional(r.url),
    publisher: optional(r.publisher),
    jurisdiction: optional(r.jurisdiction),
    effectiveDate: dateToISOOpt(r.effectiveDate),
    retrievedAt: dateTimeToISOOpt(r.retrievedAt),
    taxYear: optional(r.taxYear),
    excerpt: r.excerpt,
    normalizedRule: optional(r.normalizedRule),
    confidence: r.confidence,
    reviewBy: r.reviewBy === null ? null : dateToISO(r.reviewBy),
    status: r.status,
    tags: r.tags,
    contentHash: optional(r.contentHash),
  });
}

export function toProfessionalGuidanceRow(g: ProfessionalGuidance): Prisma.ProfessionalGuidanceCreateManyInput {
  return {
    id: g.id,
    authorRole: g.authorRole,
    authorName: nullable(g.authorName),
    title: g.title,
    body: g.body,
    receivedAt: isoToDateTime(g.receivedAt),
    approvedAt: isoToDateTimeOpt(g.approvedAt),
    approvedBy: nullable(g.approvedBy),
    appliesTo: g.appliesTo ?? [],
    status: g.status,
    supersedesId: nullable(g.supersedesId),
    documentId: nullable(g.documentId),
  };
}
export function fromProfessionalGuidanceRow(r: PC.ProfessionalGuidance): ProfessionalGuidance {
  return compact({
    id: r.id,
    authorRole: r.authorRole,
    authorName: optional(r.authorName),
    title: r.title,
    body: r.body,
    receivedAt: dateTimeToISO(r.receivedAt),
    approvedAt: dateTimeToISOOpt(r.approvedAt),
    approvedBy: optional(r.approvedBy),
    appliesTo: r.appliesTo,
    status: r.status,
    supersedesId: optional(r.supersedesId),
    documentId: optional(r.documentId),
  });
}

// ---------------------------------------------------------------------------
// Evaluation, competency, calculations
// ---------------------------------------------------------------------------

export function toEvaluationRecordRow(e: EvaluationRecord): Prisma.EvaluationRecordCreateManyInput {
  return {
    id: e.id,
    runId: e.runId,
    caseId: e.caseId,
    domain: e.domain,
    competency: e.competency,
    capabilityKey: e.capabilityKey,
    agent: e.agent,
    passed: e.passed,
    score: e.score,
    failures: e.failures ?? [],
    expectedSummary: e.expectedSummary,
    actualSummary: e.actualSummary,
    model: toJson(e.model),
    durationMs: e.durationMs,
    ranAt: isoToDateTime(e.ranAt),
  };
}
export function fromEvaluationRecordRow(r: PC.EvaluationRecord): EvaluationRecord {
  return {
    id: r.id,
    runId: r.runId,
    caseId: r.caseId,
    domain: r.domain,
    competency: r.competency,
    capabilityKey: r.capabilityKey,
    agent: r.agent as AgentName,
    passed: r.passed,
    score: r.score,
    failures: r.failures,
    expectedSummary: r.expectedSummary,
    actualSummary: r.actualSummary,
    model: fromJson<ModelInfo>(r.model),
    durationMs: r.durationMs,
    ranAt: dateTimeToISO(r.ranAt),
  };
}

export function toCompetencyScoreRow(c: CompetencyScore): Prisma.CompetencyScoreCreateManyInput {
  return {
    capabilityKey: c.capabilityKey,
    domain: c.domain,
    label: c.label,
    currentLevel: c.currentLevel,
    maxAllowedLevel: c.maxAllowedLevel,
    passRate: c.passRate,
    metrics: toJson(c.metrics ?? {}),
    evaluationCount: c.evaluationCount,
    consecutivePassingRuns: c.consecutivePassingRuns,
    lastTestedAt: isoToDateTimeOpt(c.lastTestedAt),
    failureCaseIds: c.failureCaseIds ?? [],
    promotionEligible: c.promotionEligible,
    promotionBlockers: c.promotionBlockers ?? [],
  };
}
export function fromCompetencyScoreRow(r: PC.CompetencyScore): CompetencyScore {
  return compact({
    capabilityKey: r.capabilityKey,
    domain: r.domain,
    label: r.label,
    currentLevel: r.currentLevel as AutonomyLevel,
    maxAllowedLevel: r.maxAllowedLevel as AutonomyLevel,
    passRate: r.passRate,
    metrics: fromJson<Partial<EvalMetrics>>(r.metrics),
    evaluationCount: r.evaluationCount,
    consecutivePassingRuns: r.consecutivePassingRuns,
    lastTestedAt: dateTimeToISOOpt(r.lastTestedAt),
    failureCaseIds: r.failureCaseIds,
    promotionEligible: r.promotionEligible,
    promotionBlockers: r.promotionBlockers,
  });
}

export function toCalculationRow(c: CalcResult): Prisma.CalculationCreateManyInput {
  return {
    id: c.id,
    name: c.name,
    value: toJson(c.value),
    unit: c.unit,
    formula: c.formula,
    inputs: toJson(c.inputs ?? {}),
    sourceIds: c.sourceIds ?? [],
    assumptions: toJson(c.assumptions ?? []),
    asOfDate: isoToDate(c.asOfDate),
    notes: c.notes ?? [],
    fingerprint: nullable(c.fingerprint),
  };
}
export function fromCalculationRow(r: PC.Calculation): CalcResult {
  return compact({
    id: r.id,
    name: r.name,
    value: r.value as unknown,
    unit: r.unit,
    formula: r.formula,
    inputs: fromJson<Record<string, unknown>>(r.inputs),
    sourceIds: r.sourceIds,
    assumptions: fromJson<Assumption[]>(r.assumptions),
    asOfDate: dateToISO(r.asOfDate),
    notes: r.notes,
    fingerprint: optional(r.fingerprint),
  });
}
