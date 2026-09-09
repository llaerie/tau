import { describe, expect, it } from "vitest";
import type { CalcResult, KnowledgeSource, TaxRule } from "@/lib/core/types";
import { emptyDataset } from "@/lib/core/types";
import { seedKnowledgeSources, applyRetrievedContent } from "@/lib/knowledge/sources";
import { syntheticCompanyProfile } from "@/lib/knowledge/synthetic-profile";
import { TAX_RULE_KEYS, TaxRuleStore, seedTaxRules, ruleId } from "@/lib/tax/rule-store";
import { PENDING_DUE_DATE_NOTE, buildTaxCalendar, calendarSummary } from "@/lib/tax/calendar";
import { buildTaxWorkpaper, workpaperSections, requestCpaReview, recordCpaReview } from "@/lib/tax/workpapers";
import { TaxAssumptionRegistry, seedDefaultTaxAssumptions } from "@/lib/tax/assumption-registry";
import { CpaReviewQueue } from "@/lib/tax/cpa-queue";
import { buildTaxDocumentChecklist } from "@/lib/tax/checklist";
import { classifyTaxQuestion, explainTaxQuestion } from "@/lib/tax/guard";

const ASOF = "2026-09-09";

function currentSource(id: string): KnowledgeSource {
  const s = seedKnowledgeSources().find((x) => x.id === id)!;
  return applyRetrievedContent(s, "<p>retrieved content</p>", "2026-08-01T00:00:00.000Z"); // reviewBy 2026-10-30
}

function approvedRule(key: string, taxYear: number, sourceId: string, parameters: TaxRule["parameters"], reviewBy = "2026-12-31"): TaxRule {
  return { id: ruleId(key, taxYear), jurisdiction: "FEDERAL", taxYear, key, title: key, normalizedRule: "test rule", parameters, sourceId, status: "CURRENT", confidence: 0.9, reviewBy, approvedBy: "CPA:test" };
}

describe("TaxRuleStore", () => {
  it("seeds every rule key as PENDING_RETRIEVAL without parameters, referencing pending sources", () => {
    const sources = seedKnowledgeSources();
    const rules = seedTaxRules();
    expect(rules).toHaveLength(21);
    for (const key of [
      "fed_s_corp_return_due", "ca_100s_due", "ca_s_corp_franchise_tax_rate", "ca_s_corp_minimum_franchise_tax", "fed_941_quarterly_due", "fed_940_annual_due",
      "ca_de9_quarterly_due", "fed_1099_nec_due", "ca_statement_of_information_due", "fed_social_security_rate", "fed_social_security_wage_base", "fed_medicare_rate",
      "futa_rate", "futa_wage_base", "ca_sdi_rate", "ca_sui_rate_new_employer", "ca_ett_rate", "reasonable_compensation_standard", "meals_deductibility", "home_office_rules", "international_contractor_withholding",
    ]) expect(TAX_RULE_KEYS).toContain(key);
    for (const r of rules) {
      expect(r.status).toBe("PENDING_RETRIEVAL");
      expect(r.parameters).toBeUndefined();
      expect(r.confidence).toBe(0);
      expect(sources.some((s) => s.id === r.sourceId), r.sourceId).toBe(true);
    }
    const store = new TaxRuleStore(sources, rules);
    expect(store.all()).toHaveLength(21);
    expect(store.list({ jurisdiction: "CALIFORNIA" }).length).toBeGreaterThan(5);
  });

  it("rejects rules that cite an unregistered source", () => {
    const store = new TaxRuleStore(seedKnowledgeSources());
    expect(() => store.add(approvedRule("x", 2026, "src_unknown", { dueMonth: 3, dueDay: 15 }))).toThrow(/unknown source/);
  });

  it("pending rule -> not usable with CPA escalation reason", () => {
    const store = new TaxRuleStore(seedKnowledgeSources(), seedTaxRules());
    const res = store.resolveRule("fed_941_quarterly_due", 2026, ASOF);
    expect(res.usable).toBe(false);
    expect(res.rule).not.toBeNull();
    expect(res.escalation).toBe("CPA_REVIEW_REQUIRED");
    expect(res.reason).toMatch(/PENDING_RETRIEVAL/);
    const missing = store.resolveRule("does_not_exist", 2026, ASOF);
    expect(missing.usable).toBe(false);
    expect(missing.escalation).toBe("INSUFFICIENT_INFORMATION");
  });

  it("rule CURRENT but source pending -> not usable", () => {
    const store = new TaxRuleStore(seedKnowledgeSources());
    store.add(approvedRule("fed_941_quarterly_due", 2026, "src_irs_form_941", { q1Due: "04-30" }));
    const res = store.resolveRule("fed_941_quarterly_due", 2026, ASOF);
    expect(res.usable).toBe(false);
    expect(res.reason).toMatch(/PENDING_RETRIEVAL/);
  });

  it("usable only when rule + source are CURRENT and within review windows", () => {
    const src = currentSource("src_irs_form_941");
    const store = new TaxRuleStore([src]);
    store.add(approvedRule("fed_941_quarterly_due", 2026, src.id, { q1Due: "04-30", q2Due: "07-31", q3Due: "10-31", q4Due: "01-31" }));
    expect(store.resolveRule("fed_941_quarterly_due", 2026, ASOF).usable).toBe(true);
    // stale by rule review date
    const late = store.resolveRule("fed_941_quarterly_due", 2026, "2027-01-15");
    expect(late.usable).toBe(false);
    expect(late.reason).toMatch(/stale/i);
    // stale by source review date (source reviewBy 2026-10-30)
    const srcStale = store.resolveRule("fed_941_quarterly_due", 2026, "2026-11-15");
    expect(srcStale.usable).toBe(false);
    expect(srcStale.reason).toMatch(/Source .* stale/);
    // unapproved rule is not usable
    store.add({ ...approvedRule("futa_rate", 2026, src.id, { rate: 0.5 }), approvedBy: undefined });
    expect(store.resolveRule("futa_rate", 2026, ASOF).reason).toMatch(/not been approved/);
    // markStale flips CURRENT rules past their date
    const changed = store.markStale("2027-06-01");
    expect(changed.map((r) => r.status)).toEqual(["STALE", "STALE"]);
    expect(store.resolveRule("fed_941_quarterly_due", 2026, ASOF).reason).toMatch(/STALE/);
  });

  it("falls back to a year-agnostic rule", () => {
    const src = currentSource("src_irs_pub_463");
    const store = new TaxRuleStore([src]);
    store.add({ ...approvedRule("meals_deductibility", 2026, src.id, { standard: "documented" }), taxYear: null, id: ruleId("meals_deductibility", null) });
    expect(store.find("meals_deductibility", 2025)?.taxYear).toBeNull();
  });
});

describe("tax calendar", () => {
  it("has null due dates and UNKNOWN status when rules are unusable, plus the personal reminder", () => {
    const ds = emptyDataset(syntheticCompanyProfile());
    const store = new TaxRuleStore(seedKnowledgeSources(), seedTaxRules());
    const cal = buildTaxCalendar(ds, 2026, store, ASOF);
    const kinds = new Set(cal.map((o) => o.kind));
    for (const k of ["FORM_1120S", "CA_FORM_100S", "FORM_941", "CA_DE9", "FORM_940", "1099_NEC", "CA_STATEMENT_OF_INFORMATION", "OWNER_PERSONAL_ESTIMATED_TAX_REMINDER"]) expect(kinds.has(k), k).toBe(true);
    expect(cal.filter((o) => o.kind === "FORM_941")).toHaveLength(4);
    expect(cal.filter((o) => o.kind === "CA_DE9").map((o) => o.periodLabel)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    for (const o of cal) {
      expect(o.dueDate).toBeNull();
      expect(o.amount).toBeNull();
      expect(o.requiresCpaReview).toBe(true);
      expect(o.notes).toContain(PENDING_DUE_DATE_NOTE);
      if (o.kind !== "OWNER_PERSONAL_ESTIMATED_TAX_REMINDER") expect(o.status).toBe("UNKNOWN");
    }
    const personal = cal.find((o) => o.kind === "OWNER_PERSONAL_ESTIMATED_TAX_REMINDER")!;
    expect(personal.status).toBe("NOT_APPLICABLE_PENDING_REVIEW");
    expect(personal.notes!.join(" ")).toMatch(/PERSONAL — out of scope/);
    expect(personal.notes).toContain("flagged: personal");
    const s = calendarSummary(cal);
    expect(s.unknownDueDates).toBe(cal.length);
    expect(s.personalReminders).toBe(1);
    expect(cal.find((o) => o.kind === "FORM_941")!.notes!.join(" ")).toMatch(/No workers/);
    expect(new Set(cal.map((o) => o.id)).size).toBe(cal.length);
  });

  it("computes due dates only from usable rules (with test-only parameters)", () => {
    const ds = emptyDataset(syntheticCompanyProfile());
    const src941 = currentSource("src_irs_form_941");
    const src1120 = currentSource("src_irs_form_1120s_instructions");
    const store = new TaxRuleStore([...seedKnowledgeSources().filter((s) => s.id !== src941.id && s.id !== src1120.id), src941, src1120], seedTaxRules().filter((r) => r.key !== "fed_941_quarterly_due" && r.key !== "fed_s_corp_return_due"));
    store.add(approvedRule("fed_941_quarterly_due", 2026, src941.id, { q1Due: "04-30", q2Due: "07-31", q3Due: "10-31", q4Due: "01-31" }));
    store.add(approvedRule("fed_s_corp_return_due", 2026, src1120.id, { dueMonth: 3, dueDay: 15 }));
    const cal = buildTaxCalendar(ds, 2026, store, ASOF);
    const q = cal.filter((o) => o.kind === "FORM_941");
    expect(q.map((o) => o.dueDate)).toEqual(["2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31"]);
    expect(q.map((o) => o.status)).toEqual(["DUE", "DUE", "UPCOMING", "UPCOMING"]);
    expect(cal.find((o) => o.kind === "FORM_1120S")!.dueDate).toBe("2027-03-15");
    expect(cal.find((o) => o.kind === "CA_FORM_100S")!.dueDate).toBeNull();
    expect(cal.find((o) => o.kind === "FORM_940")!.status).toBe("UNKNOWN");
  });
});

describe("workpapers & assumptions", () => {
  it("separates facts / calculations / assumptions / professional judgment and always requires CPA review", () => {
    const calc: CalcResult = { id: "calc1", name: "Officer compensation YTD", value: "27000.0000", unit: "USD", formula: "sum(payroll.owner.gross)", inputs: {}, sourceIds: ["pr1"], assumptions: [], asOfDate: ASOF };
    const wp = buildTaxWorkpaper({
      title: "Officer compensation summary",
      taxYear: 2026,
      jurisdiction: "FEDERAL",
      facts: [{ label: "Owner gross wages paid YTD", value: "27000.0000", sourceIds: ["pr1"] }, { label: "Unsourced fact", value: 1, sourceIds: [] }],
      calculations: [calc],
      assumptions: [{ key: "owner_salary_gross_monthly", description: "proposed", value: "3000.00", status: "PROFESSIONAL_REVIEW_REQUIRED", requiresProfessionalReview: true }],
      professionalJudgmentItems: ["Whether 3000.00/month is reasonable compensation"],
      createdBy: "tax_agent",
      createdAt: "2026-09-09T00:00:00.000Z",
    });
    expect(wp.cpaReviewRequired).toBe(true);
    expect(wp.cpaReviewStatus).toBe("NOT_REQUESTED");
    expect(wp.confidence).toBeLessThan(0.9);
    expect(wp.confidence).toBe(0.6);
    expect(wp.calculations).toEqual(["calc1"]);
    const sections = workpaperSections(wp, [calc]);
    expect(sections.facts[0]).toMatch(/\[sources: pr1\]/);
    expect(sections.facts[1]).toMatch(/NO SOURCE/);
    expect(sections.calculations[0]).toMatch(/formula/);
    expect(sections.assumptions[0]).toMatch(/PROFESSIONAL_REVIEW_REQUIRED/);
    expect(sections.professionalJudgment.at(-1)).toMatch(/CPA review required/);
    const requested = requestCpaReview(wp);
    expect(recordCpaReview(requested, "REVIEWED").cpaReviewStatus).toBe("REVIEWED");
    expect(() => recordCpaReview(wp, "REVIEWED")).toThrow();
    // determinism
    expect(buildTaxWorkpaper({ title: "Officer compensation summary", taxYear: 2026, jurisdiction: "FEDERAL", facts: [], calculations: [], assumptions: [], professionalJudgmentItems: [], createdBy: "x", createdAt: "2026-09-09T00:00:00.000Z" }).id).toBe(
      buildTaxWorkpaper({ title: "Officer compensation summary", taxYear: 2026, jurisdiction: "FEDERAL", facts: [], calculations: [], assumptions: [], professionalJudgmentItems: [], createdBy: "x", createdAt: "2026-09-09T00:00:00.000Z" }).id,
    );
  });

  it("assumption registry lifecycle", () => {
    const reg = new TaxAssumptionRegistry(seedDefaultTaxAssumptions());
    expect(reg.list().length).toBe(6);
    expect(reg.byKey("workforce_allocation_basis")!.value).toBeNull();
    expect(reg.blocking().map((a) => a.key)).toContain("owner_salary_gross_monthly");
    expect(() => reg.add({ key: "k", description: "d", value: null, status: "CONFIRMED", createdBy: "t" })).toThrow();
    expect(() => reg.confirm("tax_assump_workforce_basis", null, "OWNER:1")).toThrow();
    const confirmed = reg.confirm("tax_assump_workforce_basis", "GROSS", "OWNER:1", "2026-09-10T00:00:00.000Z");
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.supersedesId).toBe("tax_assump_workforce_basis");
    expect(reg.get("tax_assump_workforce_basis")!.status).toBe("SUPERSEDED");
    expect(reg.byKey("workforce_allocation_basis")!.value).toBe("GROSS");
    expect(reg.toAssumptions().find((a) => a.key === "workforce_allocation_basis")!.status).toBe("CONFIRMED");
    expect(reg.markProfessionalReview("tax_assump_fiancee_comp", "related party").status).toBe("PROFESSIONAL_REVIEW_REQUIRED");
  });
});

describe("CPA queue", () => {
  it("add / list open by urgency / resolve with guidance / withdraw", () => {
    const q = new CpaReviewQueue();
    const a = q.add({ topic: "reasonable_compensation", question: "Is 3000/month reasonable?", context: "owner salary proposed", sourceIds: ["src_irs_s_corp_compensation"], urgency: "HIGH", at: "2026-09-01T00:00:00.000Z" });
    const b = q.add({ topic: "china_workers", question: "How should the two China-based workers be classified?", context: "cross-border", urgency: "BLOCKING", at: "2026-09-02T00:00:00.000Z" });
    const c = q.add({ topic: "meals", question: "Confirm documentation standard", context: "", urgency: "LOW" });
    expect(q.listOpen().map((i) => i.id)).toEqual([b.id, a.id, c.id]);
    expect(q.addUnique({ topic: "meals", question: "Confirm documentation standard", context: "" }).id).toBe(c.id);
    expect(() => q.resolve(a.id, "", "CPA:1")).toThrow();
    const resolved = q.resolve(a.id, "guid_1", "CPA:1", "see memo", "2026-09-05T00:00:00.000Z");
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.guidanceId).toBe("guid_1");
    expect(() => q.resolve(a.id, "guid_2", "CPA:1")).toThrow();
    expect(q.withdraw(c.id, "OWNER:1").status).toBe("WITHDRAWN");
    expect(q.listOpen().map((i) => i.id)).toEqual([b.id]);
    expect(q.all()).toHaveLength(3);
    expect(() => q.get("nope")).not.toThrow();
  });
});

describe("tax document checklist", () => {
  it("marks present vs missing from dataset.documents", () => {
    const ds = emptyDataset(syntheticCompanyProfile());
    ds.bankAccounts.push({ id: "b1", name: "Checking", institution: "Synthetic Bank", accountType: "CHECKING", last4: "1001", currency: "USD", glAccountId: "acct_1000", isSynthetic: true });
    ds.workers.push({ id: "w1", displayName: "Contractor", roleTitle: "Design", country: "US", workerType: "CONTRACTOR", classificationStatus: "CONFIRMED", compensation: { type: "CONTRACT", amount: "1000.00", currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "CONFIRMED" }, startDate: "2026-01-01", isOwner: false, relatedParty: false, documentIds: [], isSynthetic: true });
    const doc = (id: string, kind: "TAX_RETURN" | "BANK_STATEMENT" | "ENTITY_DOCUMENT" | "W9", date: string, tags: string[] = []) => ({ id, kind, title: `${kind} ${date}`, date, linkedTransactionIds: [], linkedJournalEntryIds: [], storagePath: `synthetic://${id}`, mimeType: "application/pdf", classificationConfidence: 0.9, retention: { policyKey: "document_retention", retainUntil: null }, isSynthetic: true, tags, uploadedAt: `${date}T00:00:00.000Z` });
    ds.documents.push(doc("t1", "TAX_RETURN", "2025-03-01"), doc("e1", "ENTITY_DOCUMENT", "2024-01-15"), doc("w9", "W9", "2026-01-05"));
    for (let m = 1; m <= 11; m++) ds.documents.push(doc(`bs${m}`, "BANK_STATEMENT", `2026-${String(m).padStart(2, "0")}-28`));
    const cl = buildTaxDocumentChecklist(ds, 2026);
    const by = Object.fromEntries(cl.items.map((i) => [i.key, i]));
    expect(by.prior_returns.present).toBe(true);
    expect(by.entity_documents.present).toBe(true);
    expect(by.contractor_tax_forms.present).toBe(true);
    expect(by.bank_statements.present).toBe(false);
    expect(by.bank_statements.missingDetail).toEqual(["Checking:2026-12"]);
    expect(by.shareholder_basis.present).toBe(false);
    expect(by["1099s_issued"].required).toBe(true);
    expect(by.payroll_reports.required).toBe(false);
    expect(cl.missingRequiredCount).toBeGreaterThan(0);
    expect(cl.presentCount).toBe(3);
  });
});

describe("tax guard", () => {
  it("flags the prohibited list", () => {
    const cases: [string, string][] = [
      ["Take an aggressive position and hide some of the cash income", "AGGRESSIVE_POSITION"],
      ["Should we classify the China-based workers as contractors?", "WORKER_CLASSIFICATION"],
      ["Is my new developer an employee or contractor?", "WORKER_CLASSIFICATION"],
      ["Revoke the S election and convert to a C corp", "ENTITY_ELECTION_CHANGE"],
      ["Set the owner salary at 3000 per month", "REASONABLE_COMPENSATION_DECISION"],
      ["How much should I pay myself?", "REASONABLE_COMPENSATION_DECISION"],
      ["Please file the 1120-S return today", "SIGNING_OR_FILING"],
      ["Sign the Form 8879 for me", "SIGNING_OR_FILING"],
      ["Draft a response to the IRS notice CP2000", "RESPONDING_TO_AUTHORITIES"],
      ["Can we deduct my vacation as a business trip?", "AMBIGUOUS_PERSONAL_EXPENSE"],
      ["Deduct these expenses without a receipt", "UNSUPPORTED_DEDUCTION"],
      ["Just estimate the mileage numbers for the deduction", "UNSUPPORTED_DEDUCTION"],
    ];
    for (const [text, cat] of cases) {
      const r = explainTaxQuestion(text);
      expect(r.classification, text).toBe("PROHIBITED_AUTONOMOUS");
      expect(r.prohibitedCategories, text).toContain(cat);
    }
  });

  it("routes judgment vs calculation and defaults to judgment", () => {
    expect(classifyTaxQuestion("Is the coworking membership deductible?")).toBe("TAX_LAW_JUDGMENT");
    expect(classifyTaxQuestion("What is the tax treatment of a shareholder loan?")).toBe("TAX_LAW_JUDGMENT");
    expect(classifyTaxQuestion("When is Form 941 due for Q3?")).toBe("CALCULATE_WITH_APPROVED_RULE");
    expect(classifyTaxQuestion("Calculate the employer payroll tax for this payroll")).toBe("CALCULATE_WITH_APPROVED_RULE");
    expect(classifyTaxQuestion("What is the social security wage base?")).toBe("CALCULATE_WITH_APPROVED_RULE");
    expect(classifyTaxQuestion("Accrue the franchise tax liability for the quarter")).toBe("CALCULATE_WITH_APPROVED_RULE");
    expect(classifyTaxQuestion("Tell me about taxes")).toBe("TAX_LAW_JUDGMENT");
    expect(explainTaxQuestion("Tell me about taxes").reason).toMatch(/never guess/);
  });

  it("is deterministic", () => {
    const q = "Set the owner salary at 3000 per month";
    expect(explainTaxQuestion(q)).toEqual(explainTaxQuestion(q));
  });
});
