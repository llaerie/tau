/**
 * "Why did the CFO do this?" — assemble a narrative for an action, approval,
 * journal entry, agent action or calculation id from the audit trail plus the
 * dataset records that reference it.
 */
import type { AuditLog } from "@/lib/core/contracts";
import type { AuditEvent, CompanyDataset, ID } from "@/lib/core/types";
import { eventReferences } from "./audit-log";

export interface ExplanationStep {
  seq: number;
  at: string;
  eventType: string;
  actor: string;
  agent?: string;
  summary: string;
  approvalIds: ID[];
  eventId: ID;
}

export interface Explanation {
  targetId: ID;
  /** What the id resolved to in the dataset. */
  resolvedAs: ("AGENT_ACTION" | "PROPOSED_ACTION" | "APPROVAL" | "JOURNAL_ENTRY" | "CALCULATION" | "DOCUMENT" | "UNKNOWN")[];
  /** Ids folded into the search (action ids, approval ids, entry ids, sources). */
  relatedIds: ID[];
  steps: ExplanationStep[];
  sourceDocumentIds: ID[];
  calculationIds: ID[];
  approvalIds: ID[];
  riskLevel?: string;
  finalStatus?: string;
  narrative: string;
}

function collectRelated(dataset: CompanyDataset, targetId: ID): { ids: Set<ID>; resolvedAs: Explanation["resolvedAs"]; riskLevel?: string; finalStatus?: string; actionDescription?: string } {
  const ids = new Set<ID>([targetId]);
  const resolvedAs: Explanation["resolvedAs"] = [];
  let riskLevel: string | undefined;
  let finalStatus: string | undefined;
  let actionDescription: string | undefined;

  for (const aa of dataset.agentActions) {
    if (aa.id === targetId || aa.action.id === targetId || aa.approvalId === targetId) {
      resolvedAs.push(aa.id === targetId ? "AGENT_ACTION" : "PROPOSED_ACTION");
      ids.add(aa.id);
      ids.add(aa.action.id);
      if (aa.approvalId) ids.add(aa.approvalId);
      aa.action.targetIds.forEach((t) => ids.add(t));
      riskLevel = aa.risk.level;
      finalStatus = aa.status;
      actionDescription = aa.action.description;
    }
  }
  for (const ap of dataset.approvals) {
    if (ap.id === targetId || ap.action.id === targetId || ids.has(ap.action.id)) {
      if (ap.id === targetId) resolvedAs.push("APPROVAL");
      ids.add(ap.id);
      ids.add(ap.action.id);
      ap.auditEventIds.forEach((e) => ids.add(e));
      riskLevel = riskLevel ?? ap.risk.level;
      finalStatus = finalStatus ?? `approval ${ap.status}`;
      actionDescription = actionDescription ?? ap.action.description;
    }
  }
  for (const je of dataset.journalEntries) {
    if (je.id === targetId || (je.approvalId && ids.has(je.approvalId))) {
      if (je.id === targetId) resolvedAs.push("JOURNAL_ENTRY");
      ids.add(je.id);
      if (je.approvalId) ids.add(je.approvalId);
      je.sourceIds.forEach((s) => ids.add(s));
      actionDescription = actionDescription ?? je.description;
    }
  }
  if (dataset.calculations.some((c) => c.id === targetId)) resolvedAs.push("CALCULATION");
  if (dataset.documents.some((d) => d.id === targetId)) resolvedAs.push("DOCUMENT");
  if (resolvedAs.length === 0) resolvedAs.push("UNKNOWN");
  return { ids, resolvedAs, riskLevel, finalStatus, actionDescription };
}

function stepFor(e: AuditEvent): ExplanationStep {
  return {
    seq: e.seq,
    at: e.timestamp,
    eventType: e.eventType,
    actor: `${e.actor.role}:${e.actor.id}`,
    agent: e.agent,
    summary: e.explanation,
    approvalIds: e.approvalIds,
    eventId: e.id,
  };
}

export function whyDidTheCfoDoThis(auditLog: AuditLog, dataset: CompanyDataset, targetId: ID): Explanation {
  const related = collectRelated(dataset, targetId);
  const events = auditLog.list().filter((e) => e.id === targetId || Array.from(related.ids).some((id) => eventReferences(e, id)));
  const steps = events.map(stepFor);
  const sourceDocumentIds = Array.from(new Set(events.flatMap((e) => e.sourceDocumentIds)));
  const calculationIds = Array.from(new Set(events.flatMap((e) => e.calculationIds)));
  const approvalIds = Array.from(new Set(events.flatMap((e) => e.approvalIds)));

  const lines: string[] = [];
  if (related.actionDescription) lines.push(`What: ${related.actionDescription}`);
  if (related.riskLevel) lines.push(`Risk classification: ${related.riskLevel}.`);
  if (steps.length === 0) {
    lines.push(`No audit events reference ${targetId}. Either nothing happened, or it happened outside the governed path (which would itself be a control finding).`);
  } else {
    lines.push("Timeline:");
    for (const s of steps) lines.push(`  ${s.seq}. [${s.at}] ${s.eventType} by ${s.actor}${s.agent ? ` (agent ${s.agent})` : ""}: ${s.summary.split("\n")[0]}`);
  }
  if (approvalIds.length) lines.push(`Approvals involved: ${approvalIds.join(", ")}.`);
  if (sourceDocumentIds.length) lines.push(`Supporting documents: ${sourceDocumentIds.join(", ")}.`);
  if (calculationIds.length) lines.push(`Calculations relied on: ${calculationIds.join(", ")}.`);
  if (related.finalStatus) lines.push(`Outcome: ${related.finalStatus}.`);

  return {
    targetId,
    resolvedAs: related.resolvedAs,
    relatedIds: Array.from(related.ids),
    steps,
    sourceDocumentIds,
    calculationIds,
    approvalIds,
    riskLevel: related.riskLevel,
    finalStatus: related.finalStatus,
    narrative: lines.join("\n"),
  };
}
