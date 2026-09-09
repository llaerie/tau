/**
 * Local secret guards for the model layer.
 *
 * `lib/security` owns the canonical `assertNoSecretsInText`; this module provides the same
 * semantics for the model registry so that no message can reach a provider while carrying
 * an API key, AWS access key, or private key material. The check is intentionally simple
 * (regex only) and never logs the offending text.
 */
import type { ModelMessage } from "@/lib/core/contracts";
import { TauError } from "@/lib/core/errors";

export class SecretInPromptError extends TauError {
  constructor(pattern: string, location?: string) {
    super("SECRET_IN_PROMPT", `Refusing to send text to a model: it contains a secret-like token (${pattern})${location ? ` in ${location}` : ""}.`, {
      pattern,
      location,
    });
    this.name = "SecretInPromptError";
  }
}

/**
 * Patterns that indicate credential material. Word-boundary prefixes avoid flagging ordinary
 * words such as "task-list" (which contains "sk-") while still catching real keys.
 */
export const SECRET_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "sk-ant-", regex: /(^|[^A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{4,}/ },
  { label: "sk-", regex: /(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{6,}/ },
  { label: "AKIA", regex: /(^|[^A-Za-z0-9])AKIA[0-9A-Z]{12,}/ },
  { label: "-----BEGIN", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*-----/ },
];

/** Returns the label of the first secret pattern found, or null when the text is clean. */
export function findSecretPattern(text: string): string | null {
  for (const { label, regex } of SECRET_PATTERNS) {
    if (regex.test(text)) return label;
  }
  return null;
}

/** Throws `SecretInPromptError` if `text` contains a secret-like token. */
export function assertNoSecretsInText(text: string, location?: string): void {
  const hit = findSecretPattern(text);
  if (hit) throw new SecretInPromptError(hit, location);
}

/** Throws if any message content contains a secret-like token. */
export function assertNoSecretsInMessages(messages: ModelMessage[]): void {
  messages.forEach((m, i) => assertNoSecretsInText(m.content, `messages[${i}] (${m.role})`));
}

/** Throws if any of the provided strings contains a secret-like token. */
export function assertNoSecretsInTexts(texts: string[], location = "texts"): void {
  texts.forEach((t, i) => assertNoSecretsInText(t, `${location}[${i}]`));
}
