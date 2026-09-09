/**
 * Pure, deterministic text helpers shared by the providers.
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "by", "with", "is", "are",
  "was", "were", "be", "as", "it", "this", "that", "from", "into", "than", "such", "any", "all",
]);

/** Lower-case alphanumeric tokens; underscores, dashes and punctuation split words. */
export function tokenize(text: string, { dropStopWords = true }: { dropStopWords?: boolean } = {}): string[] {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  return dropStopWords ? raw.filter((t) => !STOP_WORDS.has(t)) : raw;
}

/** 32-bit FNV-1a hash (deterministic across platforms). */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Short deterministic hex digest for audit/hash fields (not cryptographic). */
export function shortHash(input: string): string {
  return fnv1a32(input).toString(16).padStart(8, "0");
}

/** Parse "$1,234.56", "(1,234.56)", "12.5%" or "1234" into a JS number for comparison only. */
export function parseLooseNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  let s = value.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$€£¥,%\s]/g, "").replace(/^(USD|CNY|EUR|GBP)/i, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Extract every balanced `{...}` JSON object from a text (fenced or inline) and return the
 * parsed values in order of appearance. Invalid candidates are skipped.
 */
export function extractJsonObjects(text: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const tryPush = (candidate: string) => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) results.push(parsed as Record<string, unknown>);
    } catch {
      /* not JSON */
    }
  };
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    tryPush(text.slice(i, end + 1));
    i = end + 1;
  }
  return results;
}

/** Parse the first JSON object (or array) from a model reply, tolerating code fences. */
export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const objects = extractJsonObjects(trimmed);
    return objects.length ? objects[0] : undefined;
  }
}

/** Rough token estimate used for usage reporting by the local provider. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Last message with the given role, or undefined. */
export function lastMessage<T extends { role: string }>(messages: T[], role: T["role"]): T | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === role) return messages[i];
  return undefined;
}
