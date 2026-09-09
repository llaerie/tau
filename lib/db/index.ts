import { resolve } from "node:path";
import type { DataStore } from "@/lib/core/contracts";
import type { CompanyDataset } from "@/lib/core/types";
import { MemoryStore } from "./memory-store";
import { PrismaStore } from "./prisma-store";

export { MemoryStore } from "./memory-store";
export { PrismaStore } from "./prisma-store";
export { getPrismaClient, disconnectPrisma } from "./prisma-client";

/** Default on-disk snapshot for the in-memory lab store (gitignored). */
export const LAB_SNAPSHOT_PATH = resolve(process.cwd(), ".tau", "lab-snapshot.json");

export interface CreateStoreOptions {
  /** Overrides TAU_STORE. */
  kind?: "memory" | "postgres";
  /** Memory store only: dataset used when no snapshot exists (or when `fresh` is set). */
  fallbackDataset?: CompanyDataset;
  /** Memory store only: ignore an existing snapshot. */
  fresh?: boolean;
  /** Memory store only: snapshot path (default `.tau/lab-snapshot.json`). */
  snapshotPath?: string;
}

/**
 * Choose the persistence backend from the environment.
 *
 *  - `TAU_STORE=postgres` → PrismaStore (DATABASE_URL required).
 *  - otherwise → MemoryStore, restored from `.tau/lab-snapshot.json` when present. When no
 *    snapshot exists a `fallbackDataset` must be supplied (typically the synthetic company).
 */
export async function createStore(options: CreateStoreOptions = {}): Promise<DataStore> {
  const kind = options.kind ?? (process.env.TAU_STORE === "postgres" ? "postgres" : "memory");
  if (kind === "postgres") {
    if (!process.env.DATABASE_URL) throw new Error("TAU_STORE=postgres requires DATABASE_URL");
    return new PrismaStore();
  }
  const snapshotPath = options.snapshotPath ?? LAB_SNAPSHOT_PATH;
  if (!options.fresh) {
    const restored = MemoryStore.fromSnapshot(snapshotPath);
    if (restored) return restored;
  }
  if (!options.fallbackDataset) {
    throw new Error(`No lab snapshot at ${snapshotPath} and no fallbackDataset provided; seed the lab first`);
  }
  return new MemoryStore(options.fallbackDataset, snapshotPath);
}
