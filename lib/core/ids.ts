import { createHash, randomUUID } from "node:crypto";

/** Deterministic id from a namespace + parts (for synthetic data & eval cases). */
export function deterministicId(prefix: string, ...parts: (string | number)[]): string {
  const h = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
  return `${prefix}_${h}`;
}
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
/** Stable JSON stringify (sorted keys) for hashing / fingerprints. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = sortKeys(o[k]);
        return acc;
      }, {});
  }
  return v;
}
export function fingerprint(value: unknown): string {
  return sha256(stableStringify(value)).slice(0, 24);
}
