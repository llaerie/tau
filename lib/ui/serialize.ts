/**
 * Plain-JSON serialization for server → client component props.
 * Drops functions, class instances become plain objects, Maps/Sets become arrays,
 * undefined values are removed. Never pass runtime objects to client components.
 */
export type Plain<T> = T extends (...args: never[]) => unknown
  ? never
  : T extends Map<infer K, infer V>
    ? [Plain<K>, Plain<V>][]
    : T extends Set<infer V>
      ? Plain<V>[]
      : T extends object
        ? { [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: Plain<T[K]> }
        : T;

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "function") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Map) return Array.from(value.entries());
  if (value instanceof Set) return Array.from(value.values());
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function toPlain<T>(value: T): Plain<T> {
  if (value === undefined) return undefined as Plain<T>;
  return JSON.parse(JSON.stringify(value, replacer)) as Plain<T>;
}

/** Safe stringify for display (never throws). */
export function pretty(value: unknown, space = 2): string {
  try {
    return JSON.stringify(value, replacer, space) ?? "";
  } catch {
    return String(value);
  }
}
