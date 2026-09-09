import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/core/types";
import { SOURCE_SEEDS, HttpSourceRetriever, NoNetworkRetriever, applyRetrievedContent, isStale, retrievalInstructionsOf, seedKnowledgeSources, stripHtml } from "@/lib/knowledge/sources";
import { GuidanceStore, promoteGuidanceToPolicy, seedRealGuidance, syntheticExampleGuidance, isSyntheticGuidance } from "@/lib/knowledge/guidance";
import { DEFAULT_RETENTION_RULES, POLICY_KEYS, defaultPolicies, policyByKey, policyParameter } from "@/lib/knowledge/policies";
import { EDUCATION_SNIPPETS, conceptsForTopic, educationFor } from "@/lib/knowledge/education";

const owner: Actor = { type: "USER", id: "owner-1", role: "OWNER" };
const cpa: Actor = { type: "USER", id: "cpa-1", role: "CPA" };
const agent: Actor = { type: "AGENT", id: "tax", role: "AGENT" };

describe("authoritative sources", () => {
  const sources = seedKnowledgeSources();

  it("seeds every required source as PENDING_RETRIEVAL with no facts", () => {
    const ids = sources.map((s) => s.id);
    for (const id of [
      "src_irs_form_1120s_instructions", "src_irs_form_941", "src_irs_form_940", "src_irs_pub_15", "src_irs_s_corp_compensation", "src_irs_form_1099_nec_instructions",
      "src_irs_form_w9", "src_irs_form_w8ben", "src_irs_estimated_taxes", "src_irs_pub_463", "src_irs_pub_946", "src_irs_pub_583",
      "src_ftb_form_100s", "src_ftb_s_corp_franchise_tax", "src_ftb_estimated_tax_corporations",
      "src_edd_de9_de9c", "src_edd_payroll_tax_rates", "src_edd_employer_registration", "src_edd_sdi",
      "src_ca_sos_statement_of_information", "src_dol_flsa_misclassification",
    ]) expect(ids).toContain(id);
    for (const s of sources) {
      expect(s.status).toBe("PENDING_RETRIEVAL");
      expect(s.excerpt).toBe("");
      expect(s.confidence).toBe(0);
      expect(s.reviewBy).toBeNull();
      expect(s.layer).toBe("AUTHORITATIVE");
      expect(s.url).toMatch(/^https:\/\/(www\.)?(irs|ftb\.ca|edd\.ca|sos\.ca|dol)\.gov/);
      expect(retrievalInstructionsOf(s)).toBeTruthy();
      expect(isStale(s, "2026-09-09")).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hard-codes no rates, percentages or dollar amounts", () => {
    const text = JSON.stringify(SOURCE_SEEDS);
    expect(text).not.toMatch(/\d+(\.\d+)?\s?%/);
    expect(text).not.toMatch(/\$\s?\d/);
  });

  it("sources.json mirrors the seed list", () => {
    const json = JSON.parse(readFileSync("knowledge/authoritative_sources/sources.json", "utf8")) as { sources: unknown };
    expect(json.sources).toEqual(sources);
  });

  it("NoNetworkRetriever never changes status", async () => {
    const r = new NoNetworkRetriever(sources);
    const s = await r.fetchSource("src_irs_pub_15");
    expect(s.status).toBe("PENDING_RETRIEVAL");
    expect(s.excerpt).toBe("");
    await expect(r.fetchSource("nope")).rejects.toThrow();
  });

  it("applyRetrievedContent sets excerpt/hash/reviewBy and staleness works", () => {
    const html = "<html><head><style>x{}</style><script>bad()</script></head><body><h1>Pub 15</h1><p>Employer&amp;guide</p></body></html>";
    expect(stripHtml(html)).toBe("Pub 15 Employer&guide");
    const s = applyRetrievedContent(sources[0], html, "2026-09-09T12:00:00.000Z");
    expect(s.status).toBe("CURRENT");
    expect(s.excerpt).toBe("Pub 15 Employer&guide");
    expect(s.reviewBy).toBe("2026-12-08");
    expect(s.contentHash).toHaveLength(64);
    expect(s.retrievedAt).toBe("2026-09-09T12:00:00.000Z");
    expect(isStale(s, "2026-10-01")).toBe(false);
    expect(isStale(s, "2026-12-09")).toBe(true);
    const long = applyRetrievedContent(sources[0], "x".repeat(10000), "2026-09-09T12:00:00.000Z");
    expect(long.excerpt.length).toBe(4000);
    const drift = applyRetrievedContent(s, "<p>changed</p>", "2026-09-10T12:00:00.000Z");
    expect(drift.tags).toContain("content-drift-detected");
  });

  it("HttpSourceRetriever uses injected fetch and handles failures", async () => {
    const ok = new HttpSourceRetriever(sources, async () => ({ ok: true, status: 200, text: async () => "<p>hello world</p>" }), () => "2026-09-09T00:00:00.000Z");
    const s = await ok.fetchSource("src_irs_form_941");
    expect(s.status).toBe("CURRENT");
    expect(s.excerpt).toBe("hello world");
    const bad = new HttpSourceRetriever(sources, async () => ({ ok: false, status: 503, text: async () => "" }));
    const f = await bad.fetchSource("src_irs_form_941");
    expect(f.status).toBe("PENDING_RETRIEVAL");
    expect(f.tags).toContain("retrieval-failed:http-503");
  });
});

describe("professional guidance", () => {
  it("has zero real guidance and one labelled synthetic memo", () => {
    expect(seedRealGuidance()).toEqual([]);
    const g = syntheticExampleGuidance();
    expect(g.title.startsWith("[SYNTHETIC LAB EXAMPLE]")).toBe(true);
    expect(isSyntheticGuidance(g)).toBe(true);
    expect(g.status).toBe("PENDING_APPROVAL");
  });

  it("add/approve/supersede lifecycle with role checks", () => {
    const store = new GuidanceStore([syntheticExampleGuidance()]);
    const g = store.require(syntheticExampleGuidance().id);
    expect(() => store.approve(g.id, agent)).toThrow();
    const approved = store.approve(g.id, owner, "2026-02-01T00:00:00.000Z");
    expect(approved.status).toBe("ACTIVE");
    expect(approved.approvedBy).toBe("OWNER:owner-1");
    expect(() => store.approve(g.id, owner)).toThrow();
    expect(() => store.add({ authorRole: "AGENT", title: "x", body: "y", appliesTo: [] })).toThrow();
    const { superseded, replacement } = store.supersede(g.id, { authorRole: "CPA", title: "[SYNTHETIC LAB EXAMPLE] v2", body: "b", appliesTo: ["meals"] });
    expect(superseded.status).toBe("SUPERSEDED");
    expect(replacement.status).toBe("PENDING_APPROVAL");
    expect(replacement.supersedesId).toBe(g.id);
    expect(store.active()).toHaveLength(0);
    expect(store.list({ appliesTo: "meals" })).toHaveLength(2);
  });

  it("promotes approved guidance to a versioned policy, superseding prior versions", () => {
    const store = new GuidanceStore([syntheticExampleGuidance()]);
    const g = store.approve(syntheticExampleGuidance().id, cpa, "2026-02-01T00:00:00.000Z");
    const existing = defaultPolicies();
    const priorMeals = policyByKey(existing, POLICY_KEYS.MEALS)!;
    expect(priorMeals.version).toBe(1);
    const r = promoteGuidanceToPolicy(g, owner, { policyKey: POLICY_KEYS.MEALS, existingPolicies: existing });
    expect(r.policy.version).toBe(2);
    expect(r.policy.status).toBe("ACTIVE");
    expect(r.policy.sourceGuidanceId).toBe(g.id);
    expect(r.policy.effectiveDate).toBe("2026-02-01");
    expect(r.supersededPolicies.map((p) => p.id)).toEqual([priorMeals.id]);
    expect(r.policies.find((p) => p.id === priorMeals.id)!.status).toBe("SUPERSEDED");
    expect(policyByKey(r.policies, POLICY_KEYS.MEALS)!.version).toBe(2);
    expect(r.policies.length).toBe(existing.length + 1);
    // third version
    const r2 = promoteGuidanceToPolicy(g, cpa, { policyKey: POLICY_KEYS.MEALS, existingPolicies: r.policies });
    expect(r2.policy.version).toBe(3);
    expect(r2.policies.filter((p) => p.key === POLICY_KEYS.MEALS && p.status === "SUPERSEDED")).toHaveLength(2);
  });

  it("refuses promotion of unapproved guidance or by agents", () => {
    const g = syntheticExampleGuidance();
    expect(() => promoteGuidanceToPolicy(g, owner, { policyKey: "meals" })).toThrow(/ACTIVE/);
    const store = new GuidanceStore([g]);
    const active = store.approve(g.id, owner);
    expect(() => promoteGuidanceToPolicy(active, agent, { policyKey: "meals" })).toThrow();
  });
});

describe("default policies", () => {
  const policies = defaultPolicies();

  it("has all eleven keys, controls ACTIVE by SYSTEM_PHASE_ONE, others DRAFT", () => {
    expect(new Set(policies.map((p) => p.key)).size).toBe(11);
    for (const k of Object.values(POLICY_KEYS)) expect(policyByKey(policies, k), k).toBeDefined();
    for (const k of [POLICY_KEYS.PERSONAL_BUSINESS_SEPARATION, POLICY_KEYS.PERIOD_LOCK, POLICY_KEYS.RELATED_PARTY, POLICY_KEYS.INTERNATIONAL_WORKER, POLICY_KEYS.AI_AUTONOMY, POLICY_KEYS.DATA_SEPARATION, POLICY_KEYS.APPROVAL_MATRIX]) {
      const p = policyByKey(policies, k)!;
      expect(p.status, k).toBe("ACTIVE");
      expect(p.approvedBy).toBe("SYSTEM_PHASE_ONE");
    }
    for (const k of [POLICY_KEYS.EXPENSE_DOCUMENTATION, POLICY_KEYS.MEALS, POLICY_KEYS.DOCUMENT_RETENTION, POLICY_KEYS.CASH_RESERVE]) {
      expect(policyByKey(policies, k)!.status, k).toBe("DRAFT");
    }
  });

  it("receipt threshold is an UNCONFIRMED parameter defaulting to 75.00", () => {
    const p = policyParameter<string>(policies, POLICY_KEYS.EXPENSE_DOCUMENTATION, "receiptThreshold");
    expect(p.value).toBe("75.00");
    expect(p.status).toBe("UNCONFIRMED");
    expect(policyParameter(policies, POLICY_KEYS.CASH_RESERVE, "minimumReserve").value).toBeNull();
    expect(policyParameter(policies, POLICY_KEYS.MEALS, "autoDeductible").value).toBe(false);
  });

  it("retention defaults are UNCONFIRMED and never asserted as law", () => {
    for (const [kind, rule] of Object.entries(DEFAULT_RETENTION_RULES)) {
      expect(rule.status, kind).toBe("UNCONFIRMED");
    }
    expect(DEFAULT_RETENTION_RULES.TAX_RETURN.permanent).toBe(true);
    expect(DEFAULT_RETENTION_RULES.BANK_STATEMENT.years).toBe(7);
    expect(DEFAULT_RETENTION_RULES.PAYROLL_REPORT.years).toBe(4);
    expect(policyByKey(policies, POLICY_KEYS.DOCUMENT_RETENTION)!.body).toMatch(/not statements of law/);
  });
});

describe("education", () => {
  it("has the 20 concepts with 2-5 sentence snippets", () => {
    expect(EDUCATION_SNIPPETS).toHaveLength(20);
    for (const s of EDUCATION_SNIPPETS) {
      const sentences = s.whyItMatters.split(/[.!?](\s|$)/).filter((x) => x.trim().length > 0).length;
      expect(sentences, s.key).toBeGreaterThanOrEqual(2);
      expect(sentences, s.key).toBeLessThanOrEqual(5);
      expect(s.whyItMatters).not.toMatch(/\d+(\.\d+)?%/);
    }
    expect(educationFor("cash_vs_profit")!.title).toBe("Cash vs. profit");
    expect(educationFor("nope")).toBeUndefined();
    expect(conceptsForTopic("tax").map((s) => s.key)).toContain("reasonable_compensation");
    expect(conceptsForTopic("cash").length).toBeGreaterThan(3);
  });
});
