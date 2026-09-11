/**
 * CPA feedback intake: guidance enters PENDING_APPROVAL, an authorized human approves it, and an
 * OWNER or CPA approver promotes it to a versioned company Policy. Everything is persisted and
 * audited; agents can never author or approve guidance.
 */
import { nowISO } from "@/lib/core/dates";
import type { Actor, AuditEvent, ID, Policy, ProfessionalGuidance } from "@/lib/core/types";
import type { LabRuntime } from "@/lib/db/runtime";
import { GUIDANCE_APPROVER_ROLES, promoteGuidanceToPolicy } from "@/lib/knowledge/guidance";

export const CPA_FEEDBACK_VERSION = "cpa-feedback:v1";
export const POLICY_PROMOTER_ROLES = ["OWNER", "CPA"] as const;

export interface CpaFeedback {
  author: string;
  title: string;
  body: string;
  /** Policy keys / topics the guidance applies to; the first becomes the policy key when promoted. */
  appliesTo: string[];
  authorRole?: "CPA" | "ATTORNEY" | "PAYROLL_PROFESSIONAL" | "AUDITOR";
  documentId?: ID;
  /** Resolve these CPA queue items with the new guidance. */
  resolvesQueueItemIds?: ID[];
}

export interface CpaFeedbackResult {
  guidance: ProfessionalGuidance;
  policy: Policy | null;
  supersededPolicies: Policy[];
  auditEventId: ID;
  auditEvent: AuditEvent;
  resolvedQueueItemIds: ID[];
  note: string;
}

function policyKeyFrom(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function ingestCpaFeedback(rt: LabRuntime, feedback: CpaFeedback, approver: Actor): Promise<CpaFeedbackResult> {
  if (!feedback.title.trim() || !feedback.body.trim()) throw new Error("CPA feedback requires a title and a body");
  if (!feedback.appliesTo.length) throw new Error("CPA feedback must name at least one topic / policy key in appliesTo");
  if (approver.type === "AGENT" || approver.role === "AGENT" || approver.role === "SYSTEM") throw new Error("Only a human may approve professional guidance");

  const at = nowISO();
  let guidance = rt.guidance.add({ authorRole: feedback.authorRole ?? "CPA", authorName: feedback.author, title: feedback.title, body: feedback.body, appliesTo: feedback.appliesTo, documentId: feedback.documentId, receivedAt: at });
  const canApprove = GUIDANCE_APPROVER_ROLES.includes(approver.role);
  let policy: Policy | null = null;
  let superseded: Policy[] = [];
  let note = "";
  if (canApprove) {
    guidance = rt.guidance.approve(guidance.id, approver, at);
    if ((POLICY_PROMOTER_ROLES as readonly string[]).includes(approver.role)) {
      const key = policyKeyFrom(feedback.appliesTo[0]);
      const result = promoteGuidanceToPolicy(guidance, approver, { policyKey: key, title: feedback.title, existingPolicies: rt.dataset.policies, effectiveDate: at.slice(0, 10) });
      policy = result.policy;
      superseded = result.supersededPolicies;
      // rt.policies aliases dataset.policies: replace contents in place so both views agree.
      rt.dataset.policies.splice(0, rt.dataset.policies.length, ...result.policies);
      await rt.store.upsertMany("policies", [...superseded, policy]);
      note = `Guidance approved and promoted to policy ${key} v${policy.version}${superseded.length ? ` (superseded ${superseded.map((p) => `v${p.version}`).join(", ")})` : ""}.`;
    } else note = `Guidance approved by ${approver.role}; only OWNER or CPA may promote it to a policy.`;
  } else note = `Guidance recorded as PENDING_APPROVAL; role ${approver.role} may not approve professional guidance.`;
  await rt.store.upsert("professionalGuidance", guidance);

  const resolvedQueueItemIds: ID[] = [];
  if (guidance.status === "ACTIVE") {
    for (const id of feedback.resolvesQueueItemIds ?? []) {
      const item = rt.cpaQueue.get(id);
      if (item && item.status === "OPEN") {
        rt.cpaQueue.resolve(id, guidance.id, `${approver.role}:${approver.id}`, feedback.title, at);
        resolvedQueueItemIds.push(id);
      }
    }
  }

  const auditEvent = await rt.audit.record({
    actor: approver,
    workflowVersion: CPA_FEEDBACK_VERSION,
    eventType: "CPA_FEEDBACK_INGESTED",
    sourceDocumentIds: feedback.documentId ? [feedback.documentId] : [],
    finalAction: policy ? `POLICY_PROMOTED ${policy.key} v${policy.version}` : `GUIDANCE_${guidance.status}`,
    explanation: `CPA feedback "${feedback.title}" from ${feedback.author} (${guidance.authorRole}) applies to ${feedback.appliesTo.join(", ")}. ${note}${resolvedQueueItemIds.length ? ` Resolved CPA queue items: ${resolvedQueueItemIds.join(", ")}.` : ""}`,
    beforeState: { guidanceId: guidance.id, policyKey: policy?.key ?? null, priorPolicyVersions: superseded.map((p) => p.version) },
    afterState: { guidanceId: guidance.id, guidanceStatus: guidance.status, policyId: policy?.id ?? null, policyVersion: policy?.version ?? null, supersededPolicyIds: superseded.map((p) => p.id), resolvedQueueItemIds },
  });
  if (rt.reindex) await rt.reindex().catch(() => undefined);
  return { guidance, policy, supersededPolicies: superseded, auditEventId: auditEvent.id, auditEvent, resolvedQueueItemIds, note };
}
