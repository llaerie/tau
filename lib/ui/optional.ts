/**
 * Loaders for subsystems that are built concurrently with the UI. Each loader uses a
 * directory-scoped dynamic import so the bundler resolves whatever exists at build time
 * and a missing module resolves to `null` at runtime instead of failing the build.
 */
export const MODULE_NOT_AVAILABLE = "module not yet available";

export interface OptionalModule<T> {
  mod: T | null;
  notice: string | null;
}

async function tryImport<T>(loader: () => Promise<unknown>, label: string): Promise<OptionalModule<T>> {
  try {
    const mod = (await loader()) as T;
    return { mod, notice: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const missing = /Cannot find module|MODULE_NOT_FOUND|Failed to resolve|not found/i.test(msg);
    return { mod: null, notice: missing ? `${label}: ${MODULE_NOT_AVAILABLE}` : `${label}: failed to load (${msg.slice(0, 160)})` };
  }
}

// The template literals below are intentional: they scope the bundler's context to one folder.
export function loadAgents<T = Record<string, unknown>>(file = "ask"): Promise<OptionalModule<T>> {
  return tryImport<T>(() => import(`@/lib/agents/${file}`), "lib/agents/ask");
}

export function loadWorkflows<T = Record<string, unknown>>(file = "index"): Promise<OptionalModule<T>> {
  return tryImport<T>(() => import(`@/lib/workflows/${file}`), "lib/workflows");
}

export function loadMonitors<T = Record<string, unknown>>(file = "index"): Promise<OptionalModule<T>> {
  return tryImport<T>(() => import(`@/lib/monitors/${file}`), "lib/monitors");
}

export function loadEvalHarness<T = Record<string, unknown>>(file = "index"): Promise<OptionalModule<T>> {
  return tryImport<T>(() => import(`@/evals/harness/${file}`), "evals/harness");
}

/** Call a named export of an optional module; returns null and the notice when unavailable. */
export async function callOptional<R>(
  loader: () => Promise<OptionalModule<Record<string, unknown>>>,
  fnName: string,
  ...args: unknown[]
): Promise<{ result: R | null; notice: string | null }> {
  const { mod, notice } = await loader();
  if (!mod) return { result: null, notice };
  const fn = mod[fnName];
  if (typeof fn !== "function") return { result: null, notice: `${fnName}: ${MODULE_NOT_AVAILABLE}` };
  try {
    const result = (await (fn as (...a: unknown[]) => unknown)(...args)) as R;
    return { result, notice: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { result: null, notice: `${fnName} failed: ${msg.slice(0, 200)}` };
  }
}
