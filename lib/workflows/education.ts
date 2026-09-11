/**
 * Pick at most one "Why this matters" snippet for a response context. Keys may be concept keys
 * (e.g. "cash_runway") or topics (e.g. "cash"); the first concept match wins, then the first
 * topic match. Never more than one snippet so answers stay short.
 */
import { EDUCATION_SNIPPETS, conceptsForTopic, educationFor, type EducationSnippet } from "@/lib/knowledge/education";

export interface EducationNote {
  key: EducationSnippet["key"];
  title: string;
  text: string;
}

export function educationForContext(keys: string[]): EducationNote | undefined {
  const normalized = keys.map((k) => k.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")).filter(Boolean);
  for (const k of normalized) {
    const s = educationFor(k);
    if (s) return { key: s.key, title: s.title, text: s.whyItMatters };
  }
  for (const k of normalized) {
    const s = conceptsForTopic(k)[0];
    if (s) return { key: s.key, title: s.title, text: s.whyItMatters };
  }
  // Loose match on words in the key against snippet keys/titles (e.g. "runway" → cash_runway).
  for (const k of normalized) {
    const s = EDUCATION_SNIPPETS.find((x) => x.key.includes(k) || x.title.toLowerCase().includes(k.replace(/_/g, " ")));
    if (s) return { key: s.key, title: s.title, text: s.whyItMatters };
  }
  return undefined;
}
