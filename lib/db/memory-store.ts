import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { DataStore, Entity } from "@/lib/core/contracts";
import type { AuditEvent, CollectionName, CompanyDataset } from "@/lib/core/types";

/**
 * In-memory store used for the Phase One training lab, tests and evals.
 * Optionally snapshots to a JSON file so the lab survives restarts.
 * Audit events are append-only: re-appending an existing id throws.
 */
export class MemoryStore implements DataStore {
  readonly kind = "memory" as const;
  private dataset: CompanyDataset;
  private auditIds = new Set<string>();
  private dirty = false;

  constructor(dataset: CompanyDataset, private readonly snapshotPath?: string) {
    this.dataset = dataset;
    for (const e of dataset.auditEvents) this.auditIds.add(e.id);
    // A store bound to a path that has no file yet persists on its first flush.
    this.dirty = !!snapshotPath && !existsSync(snapshotPath);
  }

  static fromSnapshot(path: string): MemoryStore | null {
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as CompanyDataset;
      return new MemoryStore(raw, path);
    } catch {
      return null;
    }
  }

  async load(): Promise<CompanyDataset> {
    return this.dataset;
  }

  async upsert<K extends CollectionName>(collection: K, entity: Entity<K>): Promise<void> {
    if (collection === "auditEvents") throw new Error("Audit events are append-only; use appendAudit()");
    const arr = this.dataset[collection] as Entity<K>[];
    const idx = arr.findIndex((e) => (e as { id: string }).id === (entity as { id: string }).id);
    if (idx >= 0) arr[idx] = entity;
    else arr.push(entity);
    this.dirty = true;
  }

  async upsertMany<K extends CollectionName>(collection: K, entities: Entity<K>[]): Promise<void> {
    for (const e of entities) await this.upsert(collection, e);
  }

  async appendAudit(event: AuditEvent): Promise<void> {
    if (this.auditIds.has(event.id)) throw new Error(`Audit event ${event.id} already exists (immutable log)`);
    this.auditIds.add(event.id);
    this.dataset.auditEvents.push(Object.freeze({ ...event }));
    this.dirty = true;
  }

  async reset(dataset: CompanyDataset): Promise<void> {
    const priorAudit = this.dataset.auditEvents;
    this.dataset = dataset;
    // retain prior audit history: never lose the trail on reseed
    for (const e of priorAudit) {
      if (!this.auditIds.has(e.id)) this.auditIds.add(e.id);
      if (!dataset.auditEvents.find((x) => x.id === e.id)) dataset.auditEvents.push(e);
    }
    for (const e of dataset.auditEvents) this.auditIds.add(e.id);
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.snapshotPath || !this.dirty) return;
    mkdirSync(dirname(this.snapshotPath), { recursive: true });
    writeFileSync(this.snapshotPath, JSON.stringify(this.dataset));
    this.dirty = false;
  }
}
