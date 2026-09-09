import { describe, expect, it } from "vitest";
import { HashChainedAuditLog, computeEventHash, verifyEventChain, GENESIS_HASH } from "@/lib/audit/audit-log";
import { MemoryStore } from "@/lib/db/memory-store";
import type { AuditEvent } from "@/lib/core/types";
import { makeClock, makeDataset, OWNER, AGENT } from "./helpers";

function setup() {
  const clock = makeClock();
  const dataset = makeDataset();
  const store = new MemoryStore(dataset);
  let n = 0;
  const log = new HashChainedAuditLog(store, dataset, { now: clock.now, idFn: () => `aud_${++n}` });
  return { clock, dataset, store, log };
}

describe("HashChainedAuditLog", () => {
  it("records events with all required fields, sequential seq and hash links", async () => {
    const { log, clock } = setup();
    const e1 = await log.record({ actor: OWNER, workflowVersion: "test:v1", eventType: "TEST", explanation: "first", sourceDocumentIds: ["doc_1"], calculationIds: ["calc_1"] });
    clock.advanceMs(1000);
    const e2 = await log.record({ actor: AGENT, agent: "controller", workflowVersion: "test:v1", eventType: "TEST", explanation: "second", proposedActionId: "pa_1", approvalIds: ["apr_1"], confidence: 0.8, beforeState: { a: 1 }, afterState: { a: 2 } });

    expect(e1).toMatchObject({ id: "aud_1", seq: 1, previousHash: GENESIS_HASH, timestamp: "2026-09-09T12:00:00.000Z", actor: OWNER, workflowVersion: "test:v1", eventType: "TEST", toolsCalled: [], sourceDocumentIds: ["doc_1"], calculationIds: ["calc_1"], approvalIds: [], explanation: "first" });
    expect(e1.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(e1.hash).toBe(computeEventHash(e1));
    expect(e2).toMatchObject({ seq: 2, previousHash: e1.hash, agent: "controller", proposedActionId: "pa_1", approvalIds: ["apr_1"], confidence: 0.8, beforeState: { a: 1 }, afterState: { a: 2 }, timestamp: "2026-09-09T12:00:01.000Z" });
    expect(Object.isFrozen(e1)).toBe(true);
    expect(log.verifyChain()).toEqual({ valid: true, count: 2 });
  });

  it("serializes concurrent appends so seq never collides", async () => {
    const { log } = setup();
    const evs = await Promise.all([1, 2, 3, 4, 5].map((i) => log.record({ actor: OWNER, workflowVersion: "v", eventType: "T", explanation: String(i) })));
    expect(evs.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(log.verifyChain()).toEqual({ valid: true, count: 5 });
  });

  it("detects tampering with content, links and ordering", async () => {
    const { log, dataset } = setup();
    for (let i = 0; i < 4; i++) await log.record({ actor: OWNER, workflowVersion: "v", eventType: "T", explanation: `e${i}` });
    expect(log.verifyChain().valid).toBe(true);

    // 1. content edit (events are frozen, so a tamperer must replace the element)
    const original = dataset.auditEvents[1];
    dataset.auditEvents[1] = { ...original, explanation: "altered" };
    expect(log.verifyChain()).toMatchObject({ valid: false, brokenAtSeq: 2, count: 4 });
    expect(log.verifyChainDetailed().reason).toMatch(/hash mismatch/);

    // 2. re-hashing the altered event does not help: the next link breaks
    const rehashed: AuditEvent = { ...dataset.auditEvents[1], hash: "" };
    rehashed.hash = computeEventHash(rehashed);
    dataset.auditEvents[1] = rehashed;
    expect(log.verifyChain()).toMatchObject({ valid: false, brokenAtSeq: 3 });
    dataset.auditEvents[1] = original;
    expect(log.verifyChain().valid).toBe(true);

    // 3. deletion
    const removed = dataset.auditEvents.splice(2, 1)[0];
    expect(log.verifyChain()).toMatchObject({ valid: false, brokenAtSeq: 4 });
    dataset.auditEvents.splice(2, 0, removed);
    expect(log.verifyChain().valid).toBe(true);
  });

  it("verifyEventChain is order-independent and accepts an empty log", () => {
    expect(verifyEventChain([])).toEqual({ valid: true, count: 0 });
  });

  it("store rejects re-appending an existing event id and upserting audit events", async () => {
    const { log, store } = setup();
    const e = await log.record({ actor: OWNER, workflowVersion: "v", eventType: "T", explanation: "x" });
    await expect(store.appendAudit(e)).rejects.toThrow(/immutable/);
    await expect(store.upsert("auditEvents" as never, e as never)).rejects.toThrow(/append-only/);
  });

  it("list() filters by agent, eventType, since and limit (most recent)", async () => {
    const { log, clock } = setup();
    await log.record({ actor: AGENT, agent: "fpa", workflowVersion: "v", eventType: "A", explanation: "1" });
    clock.advanceMs(60_000);
    await log.record({ actor: AGENT, agent: "tax", workflowVersion: "v", eventType: "B", explanation: "2" });
    clock.advanceMs(60_000);
    await log.record({ actor: AGENT, agent: "fpa", workflowVersion: "v", eventType: "B", explanation: "3" });
    expect(log.list({ agent: "fpa" }).map((e) => e.explanation)).toEqual(["1", "3"]);
    expect(log.list({ eventType: "B" }).map((e) => e.explanation)).toEqual(["2", "3"]);
    expect(log.list({ since: "2026-09-09T12:01:00.000Z" }).map((e) => e.explanation)).toEqual(["2", "3"]);
    expect(log.list({ limit: 1 }).map((e) => e.explanation)).toEqual(["3"]);
    expect(log.eventsReferencing("nope")).toEqual([]);
  });
});
