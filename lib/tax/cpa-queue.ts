/**
 * CPA review queue — every tax question the system may not answer on its own is queued
 * for the CPA with the context and sources the CPA needs.
 */
import type { ISODateTime } from "@/lib/core/types";
import { nowISO } from "@/lib/core/dates";

export type CpaQueueUrgency = "LOW" | "MEDIUM" | "HIGH" | "BLOCKING";
export type CpaQueueStatus = "OPEN" | "RESOLVED" | "WITHDRAWN";

export interface CpaQueueItem {
  id: string;
  topic: string;
  question: string;
  context: string;
  sourceIds: string[];
  urgency: CpaQueueUrgency;
  status: CpaQueueStatus;
  createdAt: ISODateTime;
  createdBy: string;
  relatedConfigKeys?: string[];
  resolvedAt?: ISODateTime;
  resolvedBy?: string;
  guidanceId?: string;
  resolutionNote?: string;
}

export interface NewCpaQueueItem {
  topic: string;
  question: string;
  context: string;
  sourceIds?: string[];
  urgency?: CpaQueueUrgency;
  createdBy?: string;
  relatedConfigKeys?: string[];
  id?: string;
  at?: ISODateTime;
}

const URGENCY_ORDER: Record<CpaQueueUrgency, number> = { BLOCKING: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export class CpaReviewQueue {
  private readonly items = new Map<string, CpaQueueItem>();
  private seq = 0;

  constructor(seed: CpaQueueItem[] = []) {
    for (const i of seed) this.items.set(i.id, i);
    this.seq = seed.length;
  }

  add(input: NewCpaQueueItem): CpaQueueItem {
    this.seq += 1;
    const item: CpaQueueItem = {
      id: input.id ?? `cpaq_${String(this.seq).padStart(4, "0")}`,
      topic: input.topic,
      question: input.question,
      context: input.context,
      sourceIds: [...(input.sourceIds ?? [])],
      urgency: input.urgency ?? "MEDIUM",
      status: "OPEN",
      createdAt: input.at ?? nowISO(),
      createdBy: input.createdBy ?? "SYSTEM",
      relatedConfigKeys: input.relatedConfigKeys,
    };
    this.items.set(item.id, item);
    return item;
  }

  /** Idempotent add: returns the existing OPEN item with the same topic+question if present. */
  addUnique(input: NewCpaQueueItem): CpaQueueItem {
    const existing = this.listOpen().find((i) => i.topic === input.topic && i.question === input.question);
    return existing ?? this.add(input);
  }

  get(id: string): CpaQueueItem | undefined {
    return this.items.get(id);
  }

  listOpen(): CpaQueueItem[] {
    return Array.from(this.items.values())
      .filter((i) => i.status === "OPEN")
      .sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.createdAt.localeCompare(b.createdAt));
  }

  all(): CpaQueueItem[] {
    return Array.from(this.items.values());
  }

  resolve(id: string, guidanceId: string, resolvedBy: string, note?: string, at: ISODateTime = nowISO()): CpaQueueItem {
    const item = this.require(id);
    if (item.status !== "OPEN") throw new Error(`CPA queue item ${id} is ${item.status}; only OPEN items can be resolved`);
    if (!guidanceId) throw new Error("Resolving a CPA queue item requires the id of the guidance that answers it");
    const next: CpaQueueItem = { ...item, status: "RESOLVED", guidanceId, resolvedBy, resolvedAt: at, resolutionNote: note };
    this.items.set(id, next);
    return next;
  }

  withdraw(id: string, by: string, note?: string, at: ISODateTime = nowISO()): CpaQueueItem {
    const item = this.require(id);
    if (item.status !== "OPEN") throw new Error(`CPA queue item ${id} is ${item.status}`);
    const next: CpaQueueItem = { ...item, status: "WITHDRAWN", resolvedBy: by, resolvedAt: at, resolutionNote: note };
    this.items.set(id, next);
    return next;
  }

  private require(id: string): CpaQueueItem {
    const i = this.items.get(id);
    if (!i) throw new Error(`Unknown CPA queue item: ${id}`);
    return i;
  }
}
