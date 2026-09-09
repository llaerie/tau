/**
 * Secrets handling. Secrets are read from the environment only and must never be
 * written into prompts, audit events, logs or documents. `assertNoSecretsInText`
 * is the guard every model call and outbound artifact passes through.
 */
import { ControlViolationError } from "@/lib/core/errors";

export const KNOWN_SECRET_ENV_NAMES: readonly string[] = Object.freeze([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "TAU_SESSION_SECRET",
  "DATABASE_URL",
]);

export interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = Object.freeze([
  { name: "anthropic-api-key", re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: "openai-style-key", re: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "pem-private-key", re: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/ },
  { name: "pem-block", re: /-----BEGIN [A-Z ]+-----/ },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/ },
  { name: "postgres-url-with-password", re: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i },
]);

export function getSecret(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

export function requireSecret(name: string): string {
  const v = getSecret(name);
  if (v === undefined) throw new ControlViolationError(`Required secret ${name} is not configured`, { name });
  return v;
}

/** Returns the name of the first secret pattern (or env value) found in the text, else null. */
export function findSecretInText(text: string): string | null {
  if (!text) return null;
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) return p.name;
  for (const name of KNOWN_SECRET_ENV_NAMES) {
    const v = process.env[name];
    if (v && v.length >= 8 && !PLACEHOLDER_VALUES.has(v) && text.includes(v)) return `env:${name}`;
  }
  return null;
}

const PLACEHOLDER_VALUES = new Set(["change-me-in-production", "changeme", "password"]);

export function containsSecret(text: string): boolean {
  return findSecretInText(text) !== null;
}

/** Throws ControlViolationError (code CONTROL_VIOLATION, details.kind "SECRET_LEAK") if the text contains a secret. */
export function assertNoSecretsInText(text: string, label = "text"): void {
  const hit = findSecretInText(text);
  if (hit) throw new ControlViolationError(`Refusing to proceed: ${label} contains what looks like a secret (${hit})`, { kind: "SECRET_LEAK", pattern: hit, label });
}

/** Replace secret-looking substrings so a string can be logged safely. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : `${p.re.flags}g`), `[${p.name}]`);
  for (const name of KNOWN_SECRET_ENV_NAMES) {
    const v = process.env[name];
    if (v && v.length >= 8 && !PLACEHOLDER_VALUES.has(v)) out = out.split(v).join(`[env:${name}]`);
  }
  return out;
}
