/**
 * Hash-chained, append-only audit log.
 *
 * Each event carries `seq` (monotonic), `previousHash` (the hash of the prior event,
 * or "GENESIS") and `hash` = sha256(stableStringify(event without `hash`)).
 * `verifyChain()` recomputes every hash and link, so any edit to a stored event
 * (or a removed / reordered event) is detected.
 */
import type { AuditLog, AuditLogInput, DataStore } from "@/lib/core/contracts";
import type { AgentName, AuditEvent, CompanyDataset, ID, ISODateTime } from "@/lib/core/types";
import { newId, sha256, stableStringify } from "@/lib/core/ids";
import { nowISO } from "@/lib/core/dates";

export const GENESIS_HASH = "GENESIS";

export interface AuditLogOptions {
  now?: () => ISODateTime;
  idFn?: () => ID;
}

/** Hash of an event's content (everything except `hash`). */
export function computeEventHash(event: Omit<AuditEvent, "hash"> | AuditEvent): string {
  const { hash: _ignored, ...rest } = event as AuditEvent;
  void _ignored;
  return sha256(stableStringify(rest));
}

export interface ChainVerification {
  valid: boolean;
  brokenAtSeq?: number;
  count: number;
  reason?: string;
}

/** Pure verification of an event list (sorted by seq internally). */
export function verifyEventChain(events: readonly AuditEvent[]): ChainVerification {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  let prevHash = GENESIS_HASH;
  let prevSeq = 0;
  for (const e of sorted) {
    if (e.seq !== prevSeq + 1) return { valid: false, brokenAtSeq: e.seq, count: sorted.length, reason: `seq gap: expected ${prevSeq + 1}` };
    if (e.previousHash !== prevHash) return { valid: false, brokenAtSeq: e.seq, count: sorted.length, reason: "previousHash mismatch" };
    if (computeEventHash(e) !== e.hash) return { valid: false, brokenAtSeq: e.seq, count: sorted.length, reason: "hash mismatch (content altered)" };
    prevHash = e.hash;
    prevSeq = e.seq;
  }
  return { valid: true, count: sorted.length };
}

export class HashChainedAuditLog implements AuditLog {
  private readonly now: () => ISODateTime;
  private readonly idFn: () => ID;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: DataStore,
    private readonly dataset: CompanyDataset,
    opts: AuditLogOptions = {},
  ) {
    this.now = opts.now ?? nowISO;
    this.idFn = opts.idFn ?? (() => newId("aud"));
  }

  private last(): AuditEvent | undefined {
    const evs = this.dataset.auditEvents;
    if (evs.length === 0) return undefined;
    let best = evs[0];
    for (const e of evs) if (e.seq > best.seq) best = e;
    return best;
  }

  /** Appends are serialized so concurrent callers never race for the same seq. */
  record(input: AuditLogInput): Promise<AuditEvent> {
    const run = async (): Promise<AuditEvent> => {
      const prev = this.last();
      const seq = (prev?.seq ?? 0) + 1;
      const previousHash = prev?.hash ?? GENESIS_HASH;
      const body: Omit<AuditEvent, "hash"> = {
        id: this.idFn(),
        seq,
        timestamp: this.now(),
        actor: { ...input.actor },
        agent: input.agent,
        model: input.model,
        workflowVersion: input.workflowVersion,
        promptVersion: input.promptVersion,
        eventType: input.eventType,
        toolsCalled: input.toolsCalled ?? [],
        sourceDocumentIds: input.sourceDocumentIds ?? [],
        calculationIds: input.calculationIds ?? [],
        proposedActionId: input.proposedActionId,
        finalAction: input.finalAction,
        approvalIds: input.approvalIds ?? [],
        confidence: input.confidence,
        explanation: input.explanation,
        beforeState: input.beforeState,
        afterState: input.afterState,
        previousHash,
      };
      const event: AuditEvent = { ...body, hash: computeEventHash(body) };
      await this.store.appendAudit(event);
      return Object.freeze(event);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  list(filter?: { agent?: AgentName; eventType?: string; since?: ISODateTime; limit?: number }): AuditEvent[] {
    let out = [...this.dataset.auditEvents].sort((a, b) => a.seq - b.seq);
    if (filter?.agent) out = out.filter((e) => e.agent === filter.agent);
    if (filter?.eventType) out = out.filter((e) => e.eventType === filter.eventType);
    if (filter?.since) out = out.filter((e) => e.timestamp >= filter.since!);
    if (filter?.limit !== undefined && filter.limit >= 0 && out.length > filter.limit) out = out.slice(out.length - filter.limit);
    return out;
  }

  verifyChain(): { valid: boolean; brokenAtSeq?: number; count: number } {
    const v = verifyEventChain(this.dataset.auditEvents);
    return v.brokenAtSeq === undefined ? { valid: v.valid, count: v.count } : { valid: v.valid, brokenAtSeq: v.brokenAtSeq, count: v.count };
  }

  /** Verification with the failure reason (for the UI / integrity checks). */
  verifyChainDetailed(): ChainVerification {
    return verifyEventChain(this.dataset.auditEvents);
  }

  /** Every event that references an id (action, approval, document, calculation, or state). */
  eventsReferencing(id: ID): AuditEvent[] {
    return this.list().filter((e) => eventReferences(e, id));
  }
}

export function eventReferences(e: AuditEvent, id: ID): boolean {
  if (e.proposedActionId === id || e.approvalIds.includes(id)) return true;
  if (e.sourceDocumentIds.includes(id) || e.calculationIds.includes(id)) return true;
  if (e.beforeState && stableStringify(e.beforeState).includes(`"${id}"`)) return true;
  if (e.afterState && stableStringify(e.afterState).includes(`"${id}"`)) return true;
  return false;
}
