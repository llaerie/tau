/**
 * Build the retrieval corpus from every knowledge layer plus selected company records.
 * Secrets never enter the corpus (only vault references exist in the bible anyway).
 */
import type { RetrievalDoc } from "@/lib/core/contracts";
import type { CompanyDataset, ConfigField, Policy } from "@/lib/core/types";
import type { EducationSnippet } from "@/lib/knowledge/education";
import { retrievalInstructionsOf } from "@/lib/knowledge/sources";

export interface BuildDocsOptions {
  /** Max journal entries to include (most recent first). Default 200. */
  maxJournalEntries?: number;
  includeSuperseded?: boolean;
}

const fmtValue = (v: unknown): string => {
  if (v === null || v === undefined) return "UNKNOWN (null)";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
};

export function buildRetrievalDocs(
  dataset: CompanyDataset,
  bible: ConfigField[],
  policies: Policy[],
  education: EducationSnippet[],
  opts: BuildDocsOptions = {},
): RetrievalDoc[] {
  const docs: RetrievalDoc[] = [];
  const seen = new Set<string>();
  const push = (d: RetrievalDoc) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    docs.push(d);
  };

  // Layer A — authoritative sources (status carried; pending ones have empty excerpts but are still findable by title/tags)
  for (const s of dataset.knowledgeSources) {
    const instructions = retrievalInstructionsOf(s);
    push({
      id: `ks:${s.id}`,
      layer: s.layer === "AUTHORITATIVE" ? "AUTHORITATIVE" : s.layer,
      title: s.title,
      text: s.excerpt || `NOT YET RETRIEVED. ${s.publisher ?? ""} ${s.jurisdiction ?? ""}. ${instructions ?? ""}`.trim(),
      tags: s.tags.filter((t) => !t.startsWith("retrievalInstructions:")),
      metadata: { sourceId: s.id, url: s.url, publisher: s.publisher, jurisdiction: s.jurisdiction, reviewBy: s.reviewBy, retrievedAt: s.retrievedAt, confidence: s.confidence },
      status: s.status,
    });
  }

  // Layer B — professional guidance
  for (const g of dataset.professionalGuidance) {
    if (!opts.includeSuperseded && g.status === "SUPERSEDED") continue;
    push({
      id: `guidance:${g.id}`,
      layer: "PROFESSIONAL",
      title: g.title,
      text: g.body,
      tags: ["guidance", g.authorRole.toLowerCase(), ...g.appliesTo],
      metadata: { sourceId: g.id, guidanceStatus: g.status, authorRole: g.authorRole, approvedBy: g.approvedBy },
      status: g.status === "ACTIVE" ? "CURRENT" : g.status === "SUPERSEDED" ? "SUPERSEDED" : "PENDING_RETRIEVAL",
    });
  }

  // Layer C — company policies
  for (const p of policies) {
    if (!opts.includeSuperseded && p.status === "SUPERSEDED") continue;
    push({
      id: `policy:${p.id}`,
      layer: "COMPANY",
      title: `Policy: ${p.title}`,
      text: `${p.body}\nParameters: ${fmtValue(p.parameters ?? {})}`,
      tags: ["policy", p.key, p.status.toLowerCase()],
      metadata: { sourceId: p.id, policyKey: p.key, version: p.version, policyStatus: p.status },
      status: p.status === "SUPERSEDED" ? "SUPERSEDED" : "CURRENT",
    });
  }

  // Layer C — finance bible config fields
  for (const f of bible) {
    if (!opts.includeSuperseded && f.status === "SUPERSEDED") continue;
    push({
      id: `config:${f.key}${f.status === "SUPERSEDED" ? `@${f.updatedAt ?? ""}` : ""}`,
      layer: "COMPANY",
      title: `${f.section}: ${f.label}`,
      text: `${f.label}. Status: ${f.status}. Value: ${fmtValue(f.value)}.${f.note ? ` Note: ${f.note}` : ""}`,
      tags: ["config", f.section.toLowerCase().replace(/[^a-z0-9]+/g, "_"), f.status.toLowerCase(), f.synthetic ? "synthetic" : "real"],
      metadata: { sourceId: f.key, fieldStatus: f.status, synthetic: f.synthetic ?? false, requiredConfirmer: f.requiredConfirmer },
      status: f.status === "SUPERSEDED" ? "SUPERSEDED" : "CURRENT",
    });
  }

  // Education
  for (const e of education) {
    push({
      id: `edu:${e.key}`,
      layer: "EDUCATION",
      title: e.title,
      text: e.whyItMatters,
      tags: ["education", ...e.topics],
      metadata: { sourceId: e.key, topics: e.topics },
      status: "CURRENT",
    });
  }

  // Documents (titles + extracted fields only — never binary content)
  for (const d of dataset.documents) {
    const extracted = d.extracted ? Object.entries(d.extracted).map(([k, v]) => `${k}: ${fmtValue(v)}`).join("; ") : "";
    push({
      id: `doc:${d.id}`,
      layer: "DOCUMENT",
      title: d.title,
      text: `${d.kind} dated ${d.date}${d.amount ? ` amount ${d.amount} ${d.currency ?? ""}` : ""}. ${extracted}`.trim(),
      tags: ["document", d.kind.toLowerCase(), ...(d.tags ?? []), d.isSynthetic ? "synthetic" : "real"],
      metadata: { sourceId: d.id, kind: d.kind, vendorId: d.vendorId, customerId: d.customerId, workerId: d.workerId, synthetic: d.isSynthetic },
      status: "CURRENT",
    });
  }

  // Financial records: vendors + journal entry descriptions
  for (const v of dataset.vendors) {
    push({
      id: `vendor:${v.id}`,
      layer: "FINANCIAL_RECORD",
      title: `Vendor: ${v.name}`,
      text: `${v.name} (${v.normalizedNames.join(", ")}). Country ${v.country}. ${v.isRecurring ? "Recurring vendor." : ""} Category ${v.category ?? "unknown"}. Tax doc status ${v.taxDocStatus}.`,
      tags: ["vendor", v.isRecurring ? "recurring" : "one-off", v.country.toLowerCase()],
      metadata: { sourceId: v.id, defaultAccountId: v.defaultAccountId, taxDocStatus: v.taxDocStatus },
      status: "CURRENT",
    });
  }
  const maxJe = opts.maxJournalEntries ?? 200;
  const entries = [...dataset.journalEntries].sort((a, b) => b.date.localeCompare(a.date) || b.entryNumber - a.entryNumber).slice(0, maxJe);
  for (const je of entries) {
    push({
      id: `je:${je.id}`,
      layer: "FINANCIAL_RECORD",
      title: `Journal entry #${je.entryNumber} ${je.date}`,
      text: `${je.description}${je.memo ? ` — ${je.memo}` : ""}. Source ${je.source}. Status ${je.status}. ${je.lines.map((l) => l.memo).filter(Boolean).join("; ")}`,
      tags: ["journal_entry", je.source.toLowerCase(), je.status.toLowerCase(), ...(je.tags ?? [])],
      metadata: { sourceId: je.id, date: je.date, periodId: je.periodId, entryStatus: je.status },
      status: je.status === "REVERSED" || je.status === "VOID" ? "SUPERSEDED" : "CURRENT",
    });
  }

  return docs;
}
