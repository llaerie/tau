/**
 * Layer A — Authoritative source registry.
 *
 * This environment cannot reach government websites, so every source is seeded as
 * PENDING_RETRIEVAL with an empty excerpt and confidence 0. NO tax rate, dollar
 * threshold or due date is encoded here as a fact. Facts only enter the system when
 * a retriever fetches the page, a human reviews the excerpt, and a TaxRule is
 * approved referencing the source.
 */
import type { ISODate, ISODateTime, Jurisdiction, KnowledgeSource } from "@/lib/core/types";
import { addDays, nowISO } from "@/lib/core/dates";
import { sha256 } from "@/lib/core/ids";

export const SOURCE_REVIEW_WINDOW_DAYS = 90;
export const EXCERPT_MAX_CHARS = 4000;
export const RETRIEVAL_INSTRUCTIONS_TAG_PREFIX = "retrievalInstructions:";

export interface SourceSeed {
  id: string;
  title: string;
  url: string;
  publisher: string;
  jurisdiction: Jurisdiction;
  tags: string[];
  retrievalInstructions: string;
}

const irs = (id: string, title: string, url: string, tags: string[], instr: string): SourceSeed => ({
  id: `src_irs_${id}`, title, url, publisher: "Internal Revenue Service", jurisdiction: "FEDERAL", tags: ["irs", ...tags], retrievalInstructions: instr,
});
const ftb = (id: string, title: string, url: string, tags: string[], instr: string): SourceSeed => ({
  id: `src_ftb_${id}`, title, url, publisher: "California Franchise Tax Board", jurisdiction: "CALIFORNIA", tags: ["ftb", "california", ...tags], retrievalInstructions: instr,
});
const edd = (id: string, title: string, url: string, tags: string[], instr: string): SourceSeed => ({
  id: `src_edd_${id}`, title, url, publisher: "California Employment Development Department", jurisdiction: "CALIFORNIA", tags: ["edd", "california", "payroll", ...tags], retrievalInstructions: instr,
});

export const SOURCE_SEEDS: SourceSeed[] = [
  irs("form_1120s_instructions", "Instructions for Form 1120-S, U.S. Income Tax Return for an S Corporation", "https://www.irs.gov/instructions/i1120s", ["s-corp", "income-tax", "due-date", "form-1120s"], "Fetch the current-year instructions; capture 'When To File', extension rules, and Schedule K-1 furnishing deadline. Record the tax year the instructions cover."),
  irs("form_941", "About Form 941, Employer's Quarterly Federal Tax Return", "https://www.irs.gov/forms-pubs/about-form-941", ["payroll", "form-941", "quarterly", "due-date"], "Capture quarterly filing due dates and deposit schedule references (monthly vs semiweekly). Follow the link to the instructions for the current revision."),
  irs("form_940", "About Form 940, Employer's Annual Federal Unemployment (FUTA) Tax Return", "https://www.irs.gov/forms-pubs/about-form-940", ["payroll", "form-940", "futa", "annual", "due-date", "rate", "wage-base"], "Capture the annual due date, FUTA rate, wage base and credit-reduction notes from the instructions."),
  irs("pub_15", "Publication 15 (Circular E), Employer's Tax Guide", "https://www.irs.gov/publications/p15", ["payroll", "social-security", "medicare", "rate", "wage-base", "deposit-rules"], "Capture the Social Security rate and wage base, Medicare rate and additional Medicare threshold, and deposit rules for the tax year. Record the publication year."),
  irs("s_corp_compensation", "S Corporation Compensation and Medical Insurance Issues", "https://www.irs.gov/businesses/small-businesses-self-employed/s-corporation-compensation-and-medical-insurance-issues", ["s-corp", "reasonable-compensation", "officer-compensation"], "Capture the reasonable-compensation factors verbatim. This page supports professional judgment only; it never yields a number."),
  irs("form_1099_nec_instructions", "Instructions for Forms 1099-MISC and 1099-NEC", "https://www.irs.gov/instructions/i1099mec", ["information-returns", "1099-nec", "contractors", "due-date"], "Capture who must receive a 1099-NEC, the reporting threshold, and the furnishing/filing due dates for the tax year."),
  irs("form_w9", "About Form W-9, Request for Taxpayer Identification Number and Certification", "https://www.irs.gov/forms-pubs/about-form-w-9", ["contractors", "w-9", "documentation"], "Capture when a W-9 is requested from a US payee and retention expectations."),
  irs("form_w8ben", "About Form W-8 BEN, Certificate of Foreign Status of Beneficial Owner", "https://www.irs.gov/forms-pubs/about-form-w-8-ben", ["international", "w-8ben", "foreign-persons", "withholding"], "Capture when a W-8BEN applies to a foreign individual payee and its validity period. Which form applies to a given worker is a CPA/attorney decision."),
  irs("estimated_taxes", "Estimated Taxes (corporations and individuals)", "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes", ["estimated-tax", "due-date", "personal-reminder"], "Capture the individual and corporate estimated payment schedule. Owner personal estimates are OUT OF SCOPE for the business system; store only as a reminder."),
  irs("pub_463", "Publication 463, Travel, Gift, and Car Expenses", "https://www.irs.gov/publications/p463", ["meals", "travel", "substantiation", "deductibility"], "Capture the meals deductibility percentage, substantiation requirements (amount, time, place, business purpose, attendees) and per-diem references for the tax year."),
  irs("pub_946", "Publication 946, How To Depreciate Property", "https://www.irs.gov/publications/p946", ["depreciation", "section-179", "bonus", "fixed-assets"], "Capture Section 179 limits, bonus depreciation percentage and MACRS class lives for the tax year. Tax depreciation elections are CPA decisions."),
  irs("pub_583", "Publication 583, Starting a Business and Keeping Records", "https://www.irs.gov/publications/p583", ["recordkeeping", "retention", "documents"], "Capture the recordkeeping guidance and the 'how long to keep records' table for the retention policy defaults."),
  irs("pub_587", "Publication 587, Business Use of Your Home", "https://www.irs.gov/publications/p587", ["home-office", "deductibility"], "Capture the exclusive-use and principal-place-of-business tests and the simplified method rate. Added because the home_office_rules tax rule needs it."),
  ftb("form_100s", "Form 100S, California S Corporation Franchise or Income Tax Return (booklet)", "https://www.ftb.ca.gov/forms/search/", ["s-corp", "form-100s", "due-date"], "Search the FTB forms index for the current-year 100S booklet; capture 'When to file', automatic extension and payment rules."),
  ftb("s_corp_franchise_tax", "S corporations — franchise tax rate and minimum franchise tax", "https://www.ftb.ca.gov/file/business/types/corporations/s-corporations.html", ["s-corp", "franchise-tax", "rate", "minimum-tax"], "Capture the S corporation franchise tax rate and the minimum franchise tax amount plus first-year exemptions. Never restate these numbers from memory."),
  ftb("estimated_tax_corporations", "Estimated tax payments for corporations", "https://www.ftb.ca.gov/pay/estimated-tax-payments.html", ["estimated-tax", "corporations", "due-date"], "Capture the corporate estimated payment installment schedule and minimum-tax first-installment rules."),
  edd("de9_de9c", "Required filings and due dates (DE 9 / DE 9C)", "https://edd.ca.gov/en/payroll_taxes/required_filings_and_due_dates/", ["de9", "de9c", "quarterly", "due-date"], "Capture DE 9 / DE 9C quarterly due dates and deposit (DE 88) frequency rules."),
  edd("payroll_tax_rates", "Rates and withholding (UI, ETT, SDI)", "https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/", ["rate", "sui", "ett", "sdi", "wage-base"], "Capture the UI new-employer rate and taxable wage limit, ETT rate, and SDI rate/wage limit for the tax year."),
  edd("employer_registration", "Am I required to register as an employer?", "https://edd.ca.gov/en/payroll_taxes/am_i_required_to_register_as_an_employer/", ["registration", "employer"], "Capture the registration threshold and timing for California employers."),
  edd("sdi", "State Disability Insurance — employer requirements", "https://edd.ca.gov/en/disability/employer_requirements/", ["sdi", "withholding"], "Capture employer obligations for SDI withholding and notices."),
  {
    id: "src_ca_sos_statement_of_information",
    title: "Statement of Information filing requirements (LLC)",
    url: "https://www.sos.ca.gov/business-programs/business-entities/statements",
    publisher: "California Secretary of State",
    jurisdiction: "CALIFORNIA",
    tags: ["sos", "california", "statement-of-information", "due-date", "entity-compliance"],
    retrievalInstructions: "Capture the LLC filing cadence (biennial), the filing window relative to the formation month, and the fee.",
  },
  {
    id: "src_dol_flsa_misclassification",
    title: "Employee or Independent Contractor Classification Under the FLSA",
    url: "https://www.dol.gov/agencies/whd/flsa/misclassification",
    publisher: "U.S. Department of Labor",
    jurisdiction: "FEDERAL",
    tags: ["dol", "flsa", "worker-classification"],
    retrievalInstructions: "Capture the current economic-reality test factors. Supports professional judgment only; the system never classifies workers.",
  },
];

/** Seed `KnowledgeSource` records (PENDING_RETRIEVAL, empty excerpt, confidence 0). */
export function seedKnowledgeSources(): KnowledgeSource[] {
  return SOURCE_SEEDS.map((s) => ({
    id: s.id,
    layer: "AUTHORITATIVE",
    title: s.title,
    url: s.url,
    publisher: s.publisher,
    jurisdiction: s.jurisdiction,
    excerpt: "",
    confidence: 0,
    reviewBy: null,
    status: "PENDING_RETRIEVAL",
    tags: [...s.tags, "url-unverified", `${RETRIEVAL_INSTRUCTIONS_TAG_PREFIX}${s.retrievalInstructions}`],
  }));
}

export function sourceById(sources: KnowledgeSource[], id: string): KnowledgeSource | undefined {
  return sources.find((s) => s.id === id);
}

export function retrievalInstructionsOf(source: KnowledgeSource): string | undefined {
  const t = source.tags.find((x) => x.startsWith(RETRIEVAL_INSTRUCTIONS_TAG_PREFIX));
  return t?.slice(RETRIEVAL_INSTRUCTIONS_TAG_PREFIX.length);
}

/** A source is stale when it was never retrieved, has no review date, or its review date has passed. */
export function isStale(source: KnowledgeSource, asOf: ISODate): boolean {
  if (source.status !== "CURRENT") return true;
  if (!source.reviewBy) return true;
  if (!source.retrievedAt) return true;
  return source.reviewBy < asOf;
}

// ---------------------------------------------------------------------------
// Retrievers
// ---------------------------------------------------------------------------

export interface SourceRetriever {
  fetchSource(sourceId: string): Promise<KnowledgeSource>;
}

/** Used in this environment and in tests: never touches the network, never changes status. */
export class NoNetworkRetriever implements SourceRetriever {
  constructor(private readonly sources: KnowledgeSource[]) {}
  async fetchSource(sourceId: string): Promise<KnowledgeSource> {
    const s = sourceById(this.sources, sourceId);
    if (!s) throw new Error(`Unknown knowledge source: ${sourceId}`);
    return { ...s, status: "PENDING_RETRIEVAL", tags: Array.from(new Set([...s.tags, "retrieval-skipped:no-network"])) };
  }
}

/** Strip tags/scripts/styles from HTML and collapse whitespace. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Apply a retrieved body to a source: excerpt, hash, retrievedAt, reviewBy = retrievedAt + 90 days. */
export function applyRetrievedContent(source: KnowledgeSource, body: string, retrievedAt: ISODateTime): KnowledgeSource {
  const text = stripHtml(body);
  const excerpt = text.slice(0, EXCERPT_MAX_CHARS);
  const retrievedDate = retrievedAt.slice(0, 10);
  const prevHash = source.contentHash;
  const contentHash = sha256(text);
  const tags = source.tags.filter((t) => t !== "url-unverified" && !t.startsWith("retrieval-skipped"));
  if (prevHash && prevHash !== contentHash) tags.push("content-drift-detected");
  tags.push("auto-retrieved:human-review-required");
  return {
    ...source,
    excerpt,
    contentHash,
    retrievedAt,
    reviewBy: addDays(retrievedDate, SOURCE_REVIEW_WINDOW_DAYS),
    status: "CURRENT",
    /** Retrieved but not yet human-reviewed: moderate confidence, raised only by a reviewer. */
    confidence: Math.max(source.confidence, 0.5),
    tags: Array.from(new Set(tags)),
  };
}

/**
 * Skeleton HTTP retriever (not exercised in tests). Uses global fetch; a custom
 * `fetchImpl` and clock can be injected.
 */
export class HttpSourceRetriever implements SourceRetriever {
  constructor(
    private readonly sources: KnowledgeSource[],
    private readonly fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = (u) => fetch(u),
    private readonly clock: () => ISODateTime = nowISO,
  ) {}

  async fetchSource(sourceId: string): Promise<KnowledgeSource> {
    const s = sourceById(this.sources, sourceId);
    if (!s) throw new Error(`Unknown knowledge source: ${sourceId}`);
    if (!s.url) throw new Error(`Source ${sourceId} has no url`);
    const res = await this.fetchImpl(s.url);
    if (!res.ok) {
      return { ...s, status: s.status === "CURRENT" ? "STALE" : "PENDING_RETRIEVAL", tags: Array.from(new Set([...s.tags, `retrieval-failed:http-${res.status}`])) };
    }
    return applyRetrievedContent(s, await res.text(), this.clock());
  }
}
