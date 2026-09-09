import { describe, expect, it } from "vitest";
import type { EmbeddingProvider, RetrievalDoc } from "@/lib/core/contracts";
import { emptyDataset } from "@/lib/core/types";
import { BM25Index, tokenize } from "@/lib/retrieval/bm25";
import { HybridRetriever, makeSnippet } from "@/lib/retrieval/hybrid-retriever";
import { buildRetrievalDocs } from "@/lib/retrieval/build-docs";
import { buildFinanceBible } from "@/lib/knowledge/finance-bible";
import { defaultPolicies } from "@/lib/knowledge/policies";
import { EDUCATION_SNIPPETS } from "@/lib/knowledge/education";
import { seedKnowledgeSources, applyRetrievedContent } from "@/lib/knowledge/sources";
import { syntheticExampleGuidance } from "@/lib/knowledge/guidance";
import { syntheticCompanyProfile } from "@/lib/knowledge/synthetic-profile";

function corpus() {
  const ds = emptyDataset(syntheticCompanyProfile());
  ds.knowledgeSources = seedKnowledgeSources();
  ds.professionalGuidance = [syntheticExampleGuidance()];
  ds.vendors.push({ id: "v1", name: "CloudHost Inc", normalizedNames: ["cloudhost"], isRecurring: true, category: "hosting", country: "US", taxDocStatus: "NOT_REQUIRED", active: true, createdAt: "2026-01-01T00:00:00.000Z" });
  ds.journalEntries.push({ id: "je1", entryNumber: 1, date: "2026-03-05", periodId: "2026-03", description: "Monthly cloud hosting bill CloudHost", status: "POSTED", source: "AP", lines: [], sourceIds: [], createdBy: "t", createdAt: "2026-03-05T00:00:00.000Z" });
  ds.documents.push({ id: "d1", kind: "RECEIPT", title: "Receipt CloudHost March", date: "2026-03-04", amount: "120.00", currency: "USD", linkedTransactionIds: [], linkedJournalEntryIds: [], storagePath: "synthetic://d1", mimeType: "application/pdf", classificationConfidence: 0.9, retention: { policyKey: "document_retention", retainUntil: null }, isSynthetic: true, tags: [], uploadedAt: "2026-03-04T00:00:00.000Z" });
  return buildRetrievalDocs(ds, buildFinanceBible(), defaultPolicies(), EDUCATION_SNIPPETS);
}

describe("bm25", () => {
  it("tokenizes deterministically with stopwords and light stemming", () => {
    expect(tokenize("The payments were filed by the CPA!")).toEqual(["payment", "fil", "cpa"]);
    expect(tokenize("file files filed filing")).toEqual(["fil", "fil", "fil", "fil"]);
    expect(tokenize("expense expenses")).toEqual(["expens", "expens"]);
    expect(tokenize("")).toEqual([]);
  });

  it("ranks the relevant document first and breaks ties deterministically", () => {
    const idx = new BM25Index();
    idx.add("a", "payroll liabilities are amounts owed to tax agencies");
    idx.add("b", "cash runway is months of operating cash");
    idx.add("c", "unrelated text about apples");
    const hits = idx.search("payroll tax liabilities", 2);
    expect(hits[0].id).toBe("a");
    expect(hits[0].matchedTerms.length).toBeGreaterThanOrEqual(2);
    expect(hits).toHaveLength(1);
    expect(idx.search("zzz")).toEqual([]);
  });
});

describe("buildRetrievalDocs", () => {
  it("covers every layer with provenance metadata and unique ids", () => {
    const docs = corpus();
    const layers = new Set(docs.map((d) => d.layer));
    for (const l of ["AUTHORITATIVE", "PROFESSIONAL", "COMPANY", "EDUCATION", "DOCUMENT", "FINANCIAL_RECORD"]) expect(layers.has(l as RetrievalDoc["layer"]), l).toBe(true);
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
    for (const d of docs) expect(d.metadata.sourceId, d.id).toBeTruthy();
    expect(docs.filter((d) => d.layer === "AUTHORITATIVE").every((d) => d.status === "PENDING_RETRIEVAL")).toBe(true);
    expect(docs.find((d) => d.id === "guidance:guid_synthetic_meals_documentation_standard")!.status).toBe("PENDING_RETRIEVAL");
  });
});

describe("HybridRetriever (lexical)", () => {
  it("returns narrow top-k (default 6) with provenance and snippet on every hit", async () => {
    const r = new HybridRetriever(null);
    await r.index(corpus());
    expect(r.mode).toBe("LEXICAL");
    expect(r.size()).toBeGreaterThan(50);
    const hits = await r.search("payroll tax");
    expect(hits.length).toBeLessThanOrEqual(6);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.provenance.sourceId).toBeTruthy();
      expect(h.provenance.layer).toBe(h.doc.layer);
      expect(h.provenance.title).toBe(h.doc.title);
      expect(h.snippet.length).toBeGreaterThan(0);
      expect(h.score).toBeGreaterThan(0);
    }
    const k2 = await r.search("payroll tax", { k: 2 });
    expect(k2).toHaveLength(2);
    const k100 = await r.search("payroll tax", { k: 100 });
    expect(k100.length).toBeLessThanOrEqual(20);
  });

  it("flags PENDING_RETRIEVAL / STALE sources but still returns them", async () => {
    const r = new HybridRetriever(null);
    await r.index(corpus());
    const hits = await r.search("Form 941 employer quarterly federal tax return", { layers: ["AUTHORITATIVE"] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].provenance.status).toBe("PENDING_RETRIEVAL");
    expect(hits[0].snippet.startsWith("[PENDING_RETRIEVAL]")).toBe(true);
    expect(hits[0].provenance.url).toMatch(/irs\.gov/);
    const current = await r.search("Form 941 employer quarterly", { layers: ["AUTHORITATIVE"], currentOnly: true });
    expect(current).toHaveLength(0);
  });

  it("marks a retrieved-but-expired source as flagged via status", async () => {
    const docs = corpus();
    const src = applyRetrievedContent(seedKnowledgeSources()[1], "<p>Form 941 quarterly return content</p>", "2026-01-01T00:00:00.000Z");
    const stale = { ...src, status: "STALE" as const };
    const doc = docs.find((d) => d.id === "ks:src_irs_form_941")!;
    doc.status = stale.status;
    doc.text = stale.excerpt;
    const r = new HybridRetriever(null);
    await r.index(docs);
    const hits = await r.search("Form 941 quarterly return", { layers: ["AUTHORITATIVE"] });
    expect(hits[0].provenance.status).toBe("STALE");
  });

  it("filters by layer and tags", async () => {
    const r = new HybridRetriever(null);
    await r.index(corpus());
    const edu = await r.search("cash runway months", { layers: ["EDUCATION"] });
    expect(edu.every((h) => h.doc.layer === "EDUCATION")).toBe(true);
    expect(edu[0].provenance.sourceId).toBe("cash_runway");
    const vend = await r.search("cloudhost", { layers: ["FINANCIAL_RECORD"], tags: ["vendor"] });
    expect(vend[0].provenance.sourceId).toBe("v1");
  });

  it("rejects duplicate doc ids", async () => {
    const r = new HybridRetriever(null);
    const d: RetrievalDoc = { id: "x", layer: "COMPANY", title: "t", text: "t", tags: [], metadata: {} };
    await expect(r.index([d, d])).rejects.toThrow(/Duplicate/);
  });

  it("snippet centres on query terms", () => {
    const text = `${"filler ".repeat(100)}payroll liabilities are owed to agencies ${"more ".repeat(100)}`;
    const s = makeSnippet(text, "payroll liabilities", 80);
    expect(s).toMatch(/payroll liabilities/);
    expect(s.length).toBeLessThanOrEqual(82);
  });
});

describe("HybridRetriever (with embeddings)", () => {
  /** Deterministic toy embedding: bag of chars hashed into 16 dims. */
  const toy: EmbeddingProvider = {
    info: { provider: "test", model: "toy", deterministic: true },
    dimensions: 16,
    async embed(texts) {
      return texts.map((t) => {
        const v = new Array<number>(16).fill(0);
        for (const tok of tokenize(t)) {
          let h = 0;
          for (const ch of tok) h = (h * 31 + ch.charCodeAt(0)) % 16;
          v[h] += 1;
        }
        return v;
      });
    },
  };

  it("fuses lexical and semantic ranks (RRF) and keeps provenance", async () => {
    const r = new HybridRetriever(toy);
    await r.index(corpus());
    expect(r.mode).toBe("HYBRID");
    const hits = await r.search("related party transactions disclosure", { k: 4 });
    expect(hits).toHaveLength(4);
    for (const h of hits) expect(h.provenance.sourceId).toBeTruthy();
    const keys = hits.map((h) => h.provenance.sourceId);
    expect(keys.some((k) => k === "related_party" || k === "pol_related_party_transactions_v1" || k === "revenue_model.related_party_payer")).toBe(true);
  });
});
