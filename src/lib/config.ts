
export type AppMode = "demo" | "live";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  mode: AppMode;
  dbPath: string;
  /** Secret used to sign session cookies. Required in live mode. */
  authSecret: string | null;
  anthropicApiKey: string | null;
  model: string;
}

let cached: AppConfig | null = null;

/**
 * Reads and validates configuration. Live mode is strict: a missing or weak
 * AUTH_SECRET is a hard error. There is no fallback to demo mode.
 */
export function getConfig(): AppConfig {
  if (cached) return cached;
  const rawMode = (process.env.FINANCE_DESK_MODE ?? "").trim().toLowerCase();
  if (rawMode !== "demo" && rawMode !== "live") {
    throw new ConfigError(
      `FINANCE_DESK_MODE must be "demo" or "live" (got "${rawMode || "unset"}"). Run "pnpm demo" for the synthetic-data demo, or set FINANCE_DESK_MODE=live with AUTH_SECRET for real data.`,
    );
  }
  const authSecret = (process.env.AUTH_SECRET ?? "").trim() || null;
  if (rawMode === "live" && (!authSecret || authSecret.length < 32)) {
    throw new ConfigError("Live mode requires AUTH_SECRET with at least 32 characters (try: openssl rand -hex 32). Finance Desk will not fall back to demo mode.");
  }
  cached = {
    mode: rawMode,
    dbPath: (process.env.FINANCE_DESK_DB ?? "").trim() || "./data/finance-desk.db",
    authSecret,
    anthropicApiKey: (process.env.ANTHROPIC_API_KEY ?? "").trim() || null,
    model: (process.env.FINANCE_DESK_MODEL ?? "").trim() || "claude-opus-5",
  };
  return cached;
}

export function isDemoMode(): boolean {
  return getConfig().mode === "demo";
}
