/**
 * HybridRetriever — BM25 lexical retrieval fused (reciprocal rank fusion) with optional
 * embedding similarity. Every hit carries provenance and a status; stale or
 * PENDING_RETRIEVAL sources are returned but flagged so callers never treat them as current.
 * Retrieval is deliberately narrow: top-k only (default 6).
 */
import type { EmbeddingProvider, RetrievalDoc, RetrievalHit, Retriever } from "@/lib/core/contracts";
import { BM25Index, tokenize } from "./bm25";

export const DEFAULT_TOP_K = 6;
export const MAX_TOP_K = 20;
const RRF_K = 60;
const CANDIDATE_MULTIPLIER = 4;

export interface HybridRetrieverOptions {
  defaultK?: number;
  snippetChars?: number;
}

export interface HybridSearchOptions {
  k?: number;
  layers?: RetrievalDoc["layer"][];
  tags?: string[];
  /** When true, CURRENT-only results (drops STALE / PENDING_RETRIEVAL / SUPERSEDED). Default false: return but flag. */
  currentOnly?: boolean;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Pick a window of text around the densest cluster of query terms. */
export function makeSnippet(text: string, query: string, maxChars = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const terms = tokenize(query);
  const lower = clean.toLowerCase();
  let bestPos = 0;
  let bestCount = -1;
  const windows = Math.ceil(clean.length / (maxChars / 2));
  for (let w = 0; w < windows; w++) {
    const start = Math.floor(w * (maxChars / 2));
    const slice = lower.slice(start, start + maxChars);
    const count = terms.reduce((c, t) => c + (slice.includes(t) ? 1 : 0), 0);
    if (count > bestCount) {
      bestCount = count;
      bestPos = start;
    }
  }
  const start = Math.max(0, Math.min(bestPos, clean.length - maxChars));
  const s = clean.slice(start, start + maxChars);
  return `${start > 0 ? "…" : ""}${s}${start + maxChars < clean.length ? "…" : ""}`;
}

export function isFlaggedStatus(status: RetrievalDoc["status"] | undefined): boolean {
  return status === "STALE" || status === "PENDING_RETRIEVAL" || status === "SUPERSEDED";
}

export class HybridRetriever implements Retriever {
  private readonly bm25 = new BM25Index();
  private docs = new Map<string, RetrievalDoc>();
  private vectors = new Map<string, number[]>();
  private readonly defaultK: number;
  private readonly snippetChars: number;

  constructor(private readonly embeddings: EmbeddingProvider | null = null, opts: HybridRetrieverOptions = {}) {
    this.defaultK = Math.min(opts.defaultK ?? DEFAULT_TOP_K, MAX_TOP_K);
    this.snippetChars = opts.snippetChars ?? 240;
  }

  get mode(): "LEXICAL" | "HYBRID" {
    return this.embeddings ? "HYBRID" : "LEXICAL";
  }

  async index(docs: RetrievalDoc[]): Promise<void> {
    this.bm25.clear();
    this.docs = new Map();
    this.vectors = new Map();
    for (const d of docs) {
      if (this.docs.has(d.id)) throw new Error(`Duplicate retrieval doc id: ${d.id}`);
      this.docs.set(d.id, d);
      this.bm25.add(d.id, `${d.title}\n${d.text}\n${d.tags.join(" ")}`);
    }
    if (this.embeddings && docs.length) {
      const vecs = await this.embeddings.embed(docs.map((d) => `${d.title}\n${d.text}`));
      docs.forEach((d, i) => this.vectors.set(d.id, vecs[i]));
    }
  }

  size(): number {
    return this.docs.size;
  }

  async search(query: string, opts: HybridSearchOptions = {}): Promise<RetrievalHit[]> {
    const k = Math.max(1, Math.min(opts.k ?? this.defaultK, MAX_TOP_K));
    const candidates = k * CANDIDATE_MULTIPLIER;
    const allowed = (d: RetrievalDoc): boolean =>
      (!opts.layers?.length || opts.layers.includes(d.layer)) &&
      (!opts.tags?.length || opts.tags.some((t) => d.tags.includes(t))) &&
      (!opts.currentOnly || !isFlaggedStatus(d.status));

    const lexical = this.bm25.search(query, this.docs.size).filter((h) => allowed(this.docs.get(h.id)!)).slice(0, candidates);
    const fused = new Map<string, number>();
    lexical.forEach((h, rank) => fused.set(h.id, (fused.get(h.id) ?? 0) + 1 / (RRF_K + rank + 1)));

    if (this.embeddings && this.vectors.size) {
      const [qv] = await this.embeddings.embed([query]);
      const sem = Array.from(this.vectors.entries())
        .filter(([id]) => allowed(this.docs.get(id)!))
        .map(([id, v]) => ({ id, score: cosine(qv, v) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, candidates);
      sem.forEach((h, rank) => fused.set(h.id, (fused.get(h.id) ?? 0) + 1 / (RRF_K + rank + 1)));
    }

    const ranked = Array.from(fused.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, k);

    return ranked.map(([id, score]) => this.toHit(this.docs.get(id)!, score, query));
  }

  private toHit(doc: RetrievalDoc, score: number, query: string): RetrievalHit {
    const sourceId = typeof doc.metadata.sourceId === "string" ? (doc.metadata.sourceId as string) : doc.id;
    const url = typeof doc.metadata.url === "string" ? (doc.metadata.url as string) : undefined;
    const snippet = makeSnippet(doc.text, query, this.snippetChars);
    return {
      doc,
      score,
      snippet: isFlaggedStatus(doc.status) ? `[${doc.status}] ${snippet}` : snippet,
      provenance: { sourceId, layer: doc.layer, title: doc.title, url, status: doc.status },
    };
  }
}
