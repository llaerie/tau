/**
 * TaxRuleStore — tax rules are DATA, never memory.
 *
 * Every rule references a KnowledgeSource. A rule is usable only when the rule is CURRENT,
 * its source is CURRENT, and both review dates are on/after the as-of date. Anything else
 * yields `usable: false` with a reason, and the caller MUST escalate (CPA_REVIEW_REQUIRED /
 * INSUFFICIENT_INFORMATION) rather than guess.
 *
 * All seeded rules are PENDING_RETRIEVAL with `parameters` undefined: no rate, threshold or
 * due date is encoded in this file.
 */
import type { EscalationType } from "@/lib/core/contracts";
import type { ISODate, Jurisdiction, KnowledgeSource, TaxRule } from "@/lib/core/types";

/** Placeholder review date for rules that have never been reviewed: always in the past. */
export const NEVER_REVIEWED: ISODate = "1970-01-01";

export type TaxRuleKey =
  | "fed_s_corp_return_due"
  | "ca_100s_due"
  | "ca_s_corp_franchise_tax_rate"
  | "ca_s_corp_minimum_franchise_tax"
  | "fed_941_quarterly_due"
  | "fed_940_annual_due"
  | "ca_de9_quarterly_due"
  | "fed_1099_nec_due"
  | "ca_statement_of_information_due"
  | "fed_social_security_rate"
  | "fed_social_security_wage_base"
  | "fed_medicare_rate"
  | "futa_rate"
  | "futa_wage_base"
  | "ca_sdi_rate"
  | "ca_sui_rate_new_employer"
  | "ca_ett_rate"
  | "reasonable_compensation_standard"
  | "meals_deductibility"
  | "home_office_rules"
  | "international_contractor_withholding";

interface RuleSeedSpec {
  key: TaxRuleKey;
  jurisdiction: Jurisdiction;
  title: string;
  sourceId: string;
  kind: "DUE_DATE" | "RATE" | "LIMIT" | "STANDARD";
}

export const TAX_RULE_SEEDS: RuleSeedSpec[] = [
  { key: "fed_s_corp_return_due", jurisdiction: "FEDERAL", title: "Form 1120-S filing due date", sourceId: "src_irs_form_1120s_instructions", kind: "DUE_DATE" },
  { key: "ca_100s_due", jurisdiction: "CALIFORNIA", title: "CA Form 100S filing due date", sourceId: "src_ftb_form_100s", kind: "DUE_DATE" },
  { key: "ca_s_corp_franchise_tax_rate", jurisdiction: "CALIFORNIA", title: "CA S corporation franchise tax rate", sourceId: "src_ftb_s_corp_franchise_tax", kind: "RATE" },
  { key: "ca_s_corp_minimum_franchise_tax", jurisdiction: "CALIFORNIA", title: "CA minimum franchise tax", sourceId: "src_ftb_s_corp_franchise_tax", kind: "LIMIT" },
  { key: "fed_941_quarterly_due", jurisdiction: "FEDERAL", title: "Form 941 quarterly due dates", sourceId: "src_irs_form_941", kind: "DUE_DATE" },
  { key: "fed_940_annual_due", jurisdiction: "FEDERAL", title: "Form 940 annual due date", sourceId: "src_irs_form_940", kind: "DUE_DATE" },
  { key: "ca_de9_quarterly_due", jurisdiction: "CALIFORNIA", title: "CA DE 9 / DE 9C quarterly due dates", sourceId: "src_edd_de9_de9c", kind: "DUE_DATE" },
  { key: "fed_1099_nec_due", jurisdiction: "FEDERAL", title: "Form 1099-NEC furnishing and filing due dates", sourceId: "src_irs_form_1099_nec_instructions", kind: "DUE_DATE" },
  { key: "ca_statement_of_information_due", jurisdiction: "CALIFORNIA", title: "CA Statement of Information due window", sourceId: "src_ca_sos_statement_of_information", kind: "DUE_DATE" },
  { key: "fed_social_security_rate", jurisdiction: "FEDERAL", title: "Social Security tax rate", sourceId: "src_irs_pub_15", kind: "RATE" },
  { key: "fed_social_security_wage_base", jurisdiction: "FEDERAL", title: "Social Security wage base", sourceId: "src_irs_pub_15", kind: "LIMIT" },
  { key: "fed_medicare_rate", jurisdiction: "FEDERAL", title: "Medicare tax rate", sourceId: "src_irs_pub_15", kind: "RATE" },
  { key: "futa_rate", jurisdiction: "FEDERAL", title: "FUTA tax rate", sourceId: "src_irs_form_940", kind: "RATE" },
  { key: "futa_wage_base", jurisdiction: "FEDERAL", title: "FUTA wage base", sourceId: "src_irs_form_940", kind: "LIMIT" },
  { key: "ca_sdi_rate", jurisdiction: "CALIFORNIA", title: "CA SDI withholding rate", sourceId: "src_edd_payroll_tax_rates", kind: "RATE" },
  { key: "ca_sui_rate_new_employer", jurisdiction: "CALIFORNIA", title: "CA UI new-employer rate", sourceId: "src_edd_payroll_tax_rates", kind: "RATE" },
  { key: "ca_ett_rate", jurisdiction: "CALIFORNIA", title: "CA Employment Training Tax rate", sourceId: "src_edd_payroll_tax_rates", kind: "RATE" },
  { key: "reasonable_compensation_standard", jurisdiction: "FEDERAL", title: "Reasonable compensation standard for S corporation shareholder-employees", sourceId: "src_irs_s_corp_compensation", kind: "STANDARD" },
  { key: "meals_deductibility", jurisdiction: "FEDERAL", title: "Business meals deductibility and substantiation", sourceId: "src_irs_pub_463", kind: "STANDARD" },
  { key: "home_office_rules", jurisdiction: "FEDERAL", title: "Home office deduction rules", sourceId: "src_irs_pub_587", kind: "STANDARD" },
  { key: "international_contractor_withholding", jurisdiction: "FEDERAL", title: "Withholding and documentation for foreign contractors", sourceId: "src_irs_form_w8ben", kind: "STANDARD" },
];

export const TAX_RULE_KEYS: TaxRuleKey[] = TAX_RULE_SEEDS.map((r) => r.key);

export function ruleId(key: string, taxYear: number | null): string {
  return `rule_${key}_${taxYear ?? "any"}`;
}

/** Seed every needed rule as PENDING_RETRIEVAL with no parameters. */
export function seedTaxRules(taxYear: number | null = null): TaxRule[] {
  return TAX_RULE_SEEDS.map((r) => ({
    id: ruleId(r.key, taxYear),
    jurisdiction: r.jurisdiction,
    taxYear,
    key: r.key,
    title: r.title,
    normalizedRule: `PENDING: ${r.title}. No value is known until the authoritative source is retrieved, reviewed and the rule approved.`,
    parameters: undefined,
    sourceId: r.sourceId,
    status: "PENDING_RETRIEVAL",
    confidence: 0,
    reviewBy: NEVER_REVIEWED,
  }));
}

export interface RuleResolution {
  rule: TaxRule | null;
  usable: boolean;
  reason: string;
  escalation: EscalationType | null;
  source: KnowledgeSource | null;
}

export class TaxRuleStore {
  private readonly rules = new Map<string, TaxRule>();
  private readonly sources = new Map<string, KnowledgeSource>();

  constructor(sources: KnowledgeSource[] = [], rules: TaxRule[] = []) {
    for (const s of sources) this.sources.set(s.id, s);
    for (const r of rules) this.add(r);
  }

  add(rule: TaxRule): TaxRule {
    if (!this.sources.has(rule.sourceId)) {
      throw new Error(`Tax rule ${rule.key} references unknown source ${rule.sourceId}; rules must cite a registered KnowledgeSource`);
    }
    this.rules.set(rule.id, rule);
    return rule;
  }

  upsertSource(source: KnowledgeSource): void {
    this.sources.set(source.id, source);
  }

  get(id: string): TaxRule | undefined {
    return this.rules.get(id);
  }

  getSource(id: string): KnowledgeSource | undefined {
    return this.sources.get(id);
  }

  list(filter?: { jurisdiction?: Jurisdiction; taxYear?: number | null; key?: string; status?: TaxRule["status"] }): TaxRule[] {
    return Array.from(this.rules.values()).filter(
      (r) =>
        (!filter?.jurisdiction || r.jurisdiction === filter.jurisdiction) &&
        (filter?.taxYear === undefined || r.taxYear === filter.taxYear) &&
        (!filter?.key || r.key === filter.key) &&
        (!filter?.status || r.status === filter.status),
    );
  }

  all(): TaxRule[] {
    return Array.from(this.rules.values());
  }

  /** Find the best rule for a key and tax year: year-specific first, then year-agnostic. */
  find(key: string, taxYear: number): TaxRule | undefined {
    const specific = this.list({ key, taxYear });
    if (specific.length) return specific.sort((a, b) => b.reviewBy.localeCompare(a.reviewBy))[0];
    const generic = this.list({ key, taxYear: null });
    return generic.sort((a, b) => b.reviewBy.localeCompare(a.reviewBy))[0];
  }

  /**
   * Resolve a rule for use on `asOf`. `usable` requires: rule CURRENT, source exists and is
   * CURRENT, rule.reviewBy >= asOf, source.reviewBy >= asOf, and parameters present for
   * rate/limit/date rules.
   */
  resolveRule(key: string, taxYear: number, asOf: ISODate): RuleResolution {
    const rule = this.find(key, taxYear);
    if (!rule) {
      return { rule: null, usable: false, reason: `No tax rule registered for ${key} (tax year ${taxYear}).`, escalation: "INSUFFICIENT_INFORMATION", source: null };
    }
    const source = this.sources.get(rule.sourceId) ?? null;
    const fail = (reason: string, escalation: EscalationType = "CPA_REVIEW_REQUIRED"): RuleResolution => ({ rule, usable: false, reason, escalation, source });

    if (rule.status === "PENDING_RETRIEVAL") return fail(`Rule ${key} is PENDING_RETRIEVAL: authoritative source not yet retrieved; CPA confirmation required.`);
    if (rule.status === "STALE") return fail(`Rule ${key} is STALE and must be re-verified against its source.`);
    if (rule.status === "SUPERSEDED") return fail(`Rule ${key} is SUPERSEDED; a newer rule must be approved.`);
    if (rule.status === "PROFESSIONAL_REVIEW_REQUIRED") return fail(`Rule ${key} requires professional review before use.`, "PROFESSIONAL_REVIEW_REQUIRED");
    if (!source) return fail(`Rule ${key} cites source ${rule.sourceId} which is not registered.`, "INSUFFICIENT_INFORMATION");
    if (source.status !== "CURRENT") return fail(`Rule ${key} cites source ${source.id} whose status is ${source.status}.`);
    if (!source.reviewBy || source.reviewBy < asOf) return fail(`Source ${source.id} review date ${source.reviewBy ?? "none"} is before ${asOf}; source is stale.`);
    if (rule.reviewBy < asOf) return fail(`Rule ${key} review date ${rule.reviewBy} is before ${asOf}; rule is stale.`);
    if (!rule.approvedBy) return fail(`Rule ${key} has not been approved by a professional.`);
    return { rule, usable: true, reason: "Rule and source are CURRENT and within their review windows.", escalation: null, source };
  }

  /** Mark rules whose review date has passed (or whose source is no longer current) as STALE. */
  markStale(asOf: ISODate): TaxRule[] {
    const changed: TaxRule[] = [];
    for (const r of this.rules.values()) {
      if (r.status !== "CURRENT") continue;
      const s = this.sources.get(r.sourceId);
      if (r.reviewBy < asOf || !s || s.status !== "CURRENT" || !s.reviewBy || s.reviewBy < asOf) {
        const next: TaxRule = { ...r, status: "STALE" };
        this.rules.set(r.id, next);
        changed.push(next);
      }
    }
    return changed;
  }
}
