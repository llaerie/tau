/**
 * In-memory login throttle: at most `MAX_FAILURES` failed attempts per email within
 * `WINDOW_MS`. State lives on `globalThis` so dev-mode module re-evaluation does not
 * reset it. Keys are normalized emails; no passwords are ever stored here.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type Store = Map<string, number[]>;
const KEY = Symbol.for("tau.loginRateLimit");
const g = globalThis as unknown as Record<symbol, Store | undefined>;

function store(): Store {
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

function recent(key: string, now: number): number[] {
  const list = (store().get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (list.length === 0) store().delete(key);
  else store().set(key, list);
  return list;
}

export interface RateLimitStatus {
  blocked: boolean;
  failures: number;
  /** ms until the oldest failure in the window ages out (0 when not blocked) */
  retryAfterMs: number;
}

export function loginRateLimitStatus(email: string, now = Date.now()): RateLimitStatus {
  const list = recent(email.trim().toLowerCase(), now);
  const blocked = list.length >= LOGIN_MAX_FAILURES;
  return { blocked, failures: list.length, retryAfterMs: blocked ? Math.max(0, LOGIN_WINDOW_MS - (now - list[0])) : 0 };
}

export function recordLoginFailure(email: string, now = Date.now()): RateLimitStatus {
  const key = email.trim().toLowerCase();
  const list = recent(key, now);
  list.push(now);
  store().set(key, list);
  return loginRateLimitStatus(key, now);
}

export function clearLoginFailures(email: string): void {
  store().delete(email.trim().toLowerCase());
}

/** Test hook. */
export function resetLoginRateLimits(): void {
  store().clear();
}
