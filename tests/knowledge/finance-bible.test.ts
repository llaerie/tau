import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/core/types";
import {
  BIBLE_SECTIONS,
  UNKNOWN_ITEM_SPECS,
  applyConfigAnswer,
  bibleSummary,
  blockedCapabilities,
  buildFinanceBible,
  confirmedValue,
  currentFields,
  getField,
  historyOf,
  sectionOf,
  unknownsRegistry,
} from "@/lib/knowledge/finance-bible";
import { assertAllSynthetic, buildSyntheticProfile, syntheticCompanyProfile } from "@/lib/knowledge/synthetic-profile";

const owner: Actor = { type: "USER", id: "owner-1", role: "OWNER" };

describe("finance bible", () => {
  const fields = buildFinanceBible();

  it("has exactly 30 sections and every field belongs to one", () => {
    expect(BIBLE_SECTIONS).toHaveLength(30);
    const sections = new Set(fields.map((f) => f.section));
    for (const s of BIBLE_SECTIONS) expect(sections.has(s), `section ${s} has no fields`).toBe(true);
    for (const f of fields) expect(sectionOf(f.key)).toBe(f.section);
    expect(sectionOf("nonsense.key")).toBeUndefined();
  });

  it("keys are unique and nothing is synthetic", () => {
    const keys = fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of fields) expect(f.synthetic).toBe(false);
  });

  it("unknown fields stay null (never zero) and proposed values are labelled", () => {
    for (const f of fields) {
      if (f.status === "UNCONFIRMED" && !f.note?.startsWith("PROPOSED:")) expect(f.value, f.key).toBeNull();
      expect(f.value === 0 || f.value === "0" || f.value === "0.00" || f.value === "0.0000", `${f.key} must not be zero`).toBe(false);
    }
    expect(getField(fields, "entity_profile.legal_name")!.value).toBeNull();
    expect(getField(fields, "employees.allocation_basis")!.value).toBeNull();
    expect(getField(fields, "bank_accounts.accounts")!.value).toBeNull();
  });

  it("known facts are CONFIRMED with the stated values", () => {
    expect(confirmedValue(fields, "entity_profile.entity_type")).toBe("LLC");
    expect(confirmedValue(fields, "entity_profile.tax_election")).toBe("S_CORPORATION");
    expect(confirmedValue(fields, "entity_profile.state")).toBe("CA");
    expect(confirmedValue(fields, "ownership.owner_count")).toBe(1);
    expect(confirmedValue(fields, "ownership.father_owns_llc")).toBe(false);
    expect(confirmedValue(fields, "employees.us_worker_count")).toBe(3);
    expect(confirmedValue(fields, "international_workforce.china_worker_count")).toBe(2);
    expect(confirmedValue(fields, "accounting_system.software")).toBe("NONE");
    expect(confirmedValue(fields, "cpa.cpa_exists")).toBe(true);
    expect(confirmedValue(fields, "revenue_model.deposit_destination")).toBe("COMPANY_BANK_ACCOUNT");
    // unknowns never yield a confirmed value
    expect(confirmedValue(fields, "employees.owner_salary_gross_monthly")).toBeNull();
  });

  it("professional review items carry the right status", () => {
    for (const k of ["employees.owner_salary_gross_monthly", "revenue_model.related_party_payer", "international_workforce.china_worker_classification", "cpa.responsibilities"]) {
      expect(getField(fields, k)!.status, k).toBe("PROFESSIONAL_REVIEW_REQUIRED");
    }
    expect(getField(fields, "employees.fiancee_compensation_gross_monthly")!.status).toBe("UNCONFIRMED");
    expect(getField(fields, "employees.owner_salary_gross_monthly")!.note).toMatch(/PROPOSED/);
  });

  it("EIN is stored only as a vault reference", () => {
    const f = getField(fields, "entity_profile.ein_vault_reference")!;
    expect(f.value).toBeNull();
    expect(f.note).toMatch(/vault/i);
    expect(JSON.stringify(fields)).not.toMatch(/\b\d{2}-\d{7}\b/);
  });

  it("summary counts by status add up", () => {
    const s = bibleSummary(fields);
    expect(s.total).toBe(fields.length);
    expect(s.CONFIRMED + s.UNCONFIRMED + s.PROFESSIONAL_REVIEW_REQUIRED + s.SUPERSEDED).toBe(fields.length);
    expect(s.SUPERSEDED).toBe(0);
    expect(s.UNCONFIRMED).toBeGreaterThan(s.CONFIRMED);
  });

  it("applyConfigAnswer supersedes the prior version and keeps history", () => {
    const r1 = applyConfigAnswer(fields, "entity_profile.legal_name", "Example Co LLC", owner, "CONFIRMED", { at: "2026-09-10T00:00:00.000Z" });
    expect(r1.current.status).toBe("CONFIRMED");
    expect(r1.current.value).toBe("Example Co LLC");
    expect(r1.current.updatedBy).toBe("OWNER:owner-1");
    expect(r1.history).toHaveLength(2);
    expect(r1.history[0].status).toBe("SUPERSEDED");
    expect(r1.fields.length).toBe(fields.length + 1);
    expect(currentFields(r1.fields).length).toBe(fields.length);
    // original is untouched (pure)
    expect(getField(fields, "entity_profile.legal_name")!.status).toBe("UNCONFIRMED");

    const r2 = applyConfigAnswer(r1.fields, "entity_profile.legal_name", "Example Company LLC", owner, "CONFIRMED", { at: "2026-09-11T00:00:00.000Z" });
    expect(historyOf(r2.fields, "entity_profile.legal_name").map((f) => f.status)).toEqual(["SUPERSEDED", "SUPERSEDED", "CONFIRMED"]);
    expect(getField(r2.fields, "entity_profile.legal_name")!.value).toBe("Example Company LLC");
  });

  it("refuses a CONFIRMED null and unknown keys", () => {
    expect(() => applyConfigAnswer(fields, "entity_profile.legal_name", null, owner, "CONFIRMED")).toThrow();
    expect(() => applyConfigAnswer(fields, "bogus.key", "x", owner)).toThrow();
  });

  it("unknowns registry has exactly the 26 setup items", () => {
    const reg = unknownsRegistry(fields);
    expect(UNKNOWN_ITEM_SPECS).toHaveLength(26);
    expect(reg).toHaveLength(26);
    const keys = reg.map((r) => r.key);
    expect(new Set(keys).size).toBe(26);
    for (const k of [
      "legal_company_name", "ein_reference_architecture", "business_address", "fiscal_year", "accounting_method", "cpa_identity", "cpa_responsibilities",
      "bank_accounts", "cards", "payroll_provider", "employee_compensation", "china_worker_classification", "invoicing_process", "customer_entity",
      "payment_terms", "formal_service_agreement", "business_insurance", "tax_payment_history", "prior_tax_returns", "opening_balances", "fixed_assets",
      "loans", "owner_basis_information", "chart_of_accounts", "reimbursement_rules", "approval_thresholds",
    ]) expect(keys, k).toContain(k);
    for (const item of reg) {
      expect(item.status).not.toBe("CONFIRMED");
      expect(item.whyItMatters.length).toBeGreaterThan(20);
      expect(item.blocksCapabilities.length).toBeGreaterThan(0);
      expect(BIBLE_SECTIONS).toContain(item.section);
      expect(getField(fields, item.fieldKey), item.fieldKey).toBeDefined();
    }
    expect(reg.find((r) => r.key === "employee_compensation")!.label).toMatch(/8,000/);
    expect(reg.find((r) => r.key === "china_worker_classification")!.whoCanAnswer).toBe("CPA");
  });

  it("blocked capabilities clear as items are answered", () => {
    const before = blockedCapabilities(fields);
    expect(before.cpa_package.length).toBeGreaterThan(0);
    const answered = applyConfigAnswer(fields, "bank_accounts.accounts", [{ institution: "X", last4: "1234" }], owner).fields;
    expect(blockedCapabilities(answered).bank_reconciliation).not.toContain("bank_accounts");
    expect(unknownsRegistry(answered).find((r) => r.key === "bank_accounts")!.status).toBe("CONFIRMED");
  });
});

describe("synthetic profile", () => {
  it("is fully synthetic and separate from the real bible", () => {
    const syn = buildSyntheticProfile();
    expect(() => assertAllSynthetic(syn)).not.toThrow();
    for (const f of syn) expect(f.synthetic).toBe(true);
    const real = buildFinanceBible();
    expect(() => assertAllSynthetic(real)).toThrow();
    expect(syn.find((f) => f.key === "entity_profile.legal_name")!.value).toBe("Northlight AI Services LLC");
    expect(real.find((f) => f.key === "entity_profile.legal_name")!.value).toBeNull();
    for (const f of syn) expect(sectionOf(f.key)).toBe(f.section);
  });

  it("produces a CompanyProfile flagged synthetic", () => {
    const p = syntheticCompanyProfile();
    expect(p.isSynthetic).toBe(true);
    expect(p.entityType.value).toBe("LLC");
    expect(p.accountingMethod.value).toBe("ACCRUAL");
    expect(p.entityType.synthetic).toBe(true);
  });
});
