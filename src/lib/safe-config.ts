import { ConfigError, getConfig, type AppConfig } from "./config";

export function safeConfig(): { config: AppConfig; error: null } | { config: null; error: string } {
  try {
    return { config: getConfig(), error: null };
  } catch (err) {
    if (err instanceof ConfigError) return { config: null, error: err.message };
    throw err;
  }
}
