/**
 * Deterministic lexical retrieval: tokenizer + BM25 index. No external dependencies.
 */

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is", "it", "its", "of", "on", "or",
  "that", "the", "this", "to", "was", "were", "will", "with", "what", "when", "how", "do", "does", "i", "my", "we", "our", "you", "your",
]);

/** Light suffix stripping so "payments" ~ "payment", "filed" ~ "file". */
function stem(t: string): string {
  if (t.length <= 3) return t;
  let s = t;
  if (s.endsWith("ies") && s.length > 4) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith("ing") && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith("ed") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("es") && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  // drop a trailing silent "e" so file/filed/files and expense/expenses share a stem
  if (s.endsWith("e") && s.length > 3) s = s.slice(0, -1);
  return s;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[_/]/g, " ")
    .split(/[^a-z0-9$%.-]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
}

export interface BM25Options {
  k1?: number;
  b?: number;
}

export interface BM25Hit {
  id: string;
  score: number;
  /** query terms that matched this document */
  matchedTerms: string[];
}

interface IndexedDoc {
  id: string;
  length: number;
  tf: Map<string, number>;
}

export class BM25Index {
  private readonly k1: number;
  private readonly b: number;
  private docs: IndexedDoc[] = [];
  private df = new Map<string, number>();
  private avgLength = 0;

  constructor(opts: BM25Options = {}) {
    this.k1 = opts.k1 ?? 1.2;
    this.b = opts.b ?? 0.75;
  }

  clear(): void {
    this.docs = [];
    this.df = new Map();
    this.avgLength = 0;
  }

  add(id: string, text: string): void {
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.docs.push({ id, length: tokens.length, tf });
    this.avgLength = this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length;
  }

  size(): number {
    return this.docs.length;
  }

  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  search(query: string, k = 10): BM25Hit[] {
    const qTerms = Array.from(new Set(tokenize(query)));
    if (!qTerms.length || !this.docs.length) return [];
    const hits: BM25Hit[] = [];
    for (const d of this.docs) {
      let score = 0;
      const matched: string[] = [];
      for (const q of qTerms) {
        const f = d.tf.get(q);
        if (!f) continue;
        matched.push(q);
        const idf = this.idf(q);
        const denom = f + this.k1 * (1 - this.b + (this.b * d.length) / (this.avgLength || 1));
        score += idf * ((f * (this.k1 + 1)) / denom);
      }
      if (score > 0) hits.push({ id: d.id, score, matchedTerms: matched });
    }
    // deterministic ordering: score desc, then id asc
    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return hits.slice(0, k);
  }
}
