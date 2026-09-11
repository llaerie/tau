/**
 * Company shape for the synthetic lab: profile, chart of accounts, bank accounts and card,
 * workers (including the two unresolved China-based workers), vendors and customers.
 */
import { buildChartOfAccounts } from "@/lib/accounting/chart-of-accounts";
import { addMonths } from "@/lib/core/dates";
import { money } from "@/lib/core/money";
import type { CompanyProfile, ConfigField, Customer, ISODate, Vendor, Worker } from "@/lib/core/types";
import { internationalReviewFields } from "@/lib/knowledge/international-review";
import { acct, sid, ts, type GenContext } from "./context";

export const SYNTHETIC_COMPANY_ID = "co_northlight_synthetic";
export const SYNTHETIC_DISPLAY_NAME = "Northlight AI Services LLC (SYNTHETIC)";

function entityField<T>(key: string, label: string, value: T): ConfigField<T> {
  return { key, section: "entity", label, value, status: "CONFIRMED", synthetic: true, note: "Synthetic lab fact — not a real company record", updatedAt: ts("2025-06-01"), updatedBy: "synthetic_generator" };
}

export function buildProfile(asOfDate: ISODate): CompanyProfile {
  return {
    id: SYNTHETIC_COMPANY_ID,
    displayName: SYNTHETIC_DISPLAY_NAME,
    isSynthetic: true,
    entityType: entityField("entityType", "Entity type", "LLC (California)"),
    taxElection: entityField("taxElection", "Federal tax election", "S_CORPORATION"),
    state: entityField("state", "State of formation", "CA"),
    fiscalYearEnd: entityField("fiscalYearEnd", "Fiscal year end", "12-31"),
    accountingMethod: entityField<"CASH" | "ACCRUAL">("accountingMethod", "Accounting method", "ACCRUAL"),
    functionalCurrency: "USD",
    asOfDate,
  };
}

interface VendorSpec {
  key: string;
  name: string;
  aliases: string[];
  code?: string;
  recurring: boolean;
  category: string;
  country?: string;
  taxDoc: Vendor["taxDocStatus"];
}

const VENDOR_SPECS: VendorSpec[] = [
  { key: "github", name: "GitHub, Inc.", aliases: ["GITHUB", "GITHUB TEAM"], code: "7000", recurring: true, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "google", name: "Google Workspace", aliases: ["GOOGLE *WORKSPACE", "GOOGLE WORKSPACE"], code: "7000", recurring: true, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "notion", name: "Notion Labs", aliases: ["NOTION LABS", "NOTION"], code: "7000", recurring: true, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "slack", name: "Slack Technologies", aliases: ["SLACK", "SLACK T* "], code: "7000", recurring: true, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "openai", name: "OpenAI (API usage)", aliases: ["OPENAI", "OPENAI *API"], code: "5100", recurring: true, category: "cost_of_revenue", taxDoc: "NOT_REQUIRED" },
  { key: "aws", name: "Amazon Web Services", aliases: ["AMAZON WEB SERVICES", "AWS EMEA", "AWS"], code: "5000", recurring: true, category: "cost_of_revenue", taxDoc: "NOT_REQUIRED" },
  { key: "zoom", name: "Zoom Video Communications", aliases: ["ZOOM.US", "ZOOM"], code: "7000", recurring: true, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "adobe", name: "Adobe Inc.", aliases: ["ADOBE", "ADOBE *CREATIVE CLOUD"], code: "7000", recurring: true, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "coworking", name: "Brightwork Coworking", aliases: ["BRIGHTWORK COWORKING", "BRIGHTWORK"], code: "7100", recurring: true, category: "rent", taxDoc: "ON_FILE" },
  { key: "internet", name: "Metronet Fiber Business", aliases: ["METRONET FIBER", "METRONET"], code: "7150", recurring: true, category: "utilities", taxDoc: "NOT_REQUIRED" },
  { key: "phone", name: "Telnorth Mobile", aliases: ["TELNORTH MOBILE", "TELNORTH"], code: "7450", recurring: true, category: "telecom", taxDoc: "NOT_REQUIRED" },
  { key: "insurance", name: "Hartline Business Insurance", aliases: ["HARTLINE INSURANCE", "HARTLINE"], code: "7250", recurring: true, category: "insurance", taxDoc: "NOT_REQUIRED" },
  { key: "cpa", name: "Kestrel Tax & Advisory LLP", aliases: ["KESTREL TAX", "KESTREL TAX & ADVISORY"], code: "7200", recurring: true, category: "professional_fees", taxDoc: "ON_FILE" },
  { key: "payroll", name: "Paystream Payroll Services", aliases: ["PAYSTREAM PAYROLL", "PAYSTREAM"], code: "6190", recurring: true, category: "payroll_service", taxDoc: "NOT_REQUIRED" },
  { key: "intlplatform", name: "GlobalPay International Platform", aliases: ["INTL PAYMENT PLATFORM", "GLOBALPAY"], code: "6060", recurring: true, category: "international_payments", taxDoc: "NOT_REQUIRED" },
  { key: "amazon", name: "Amazon Marketplace", aliases: ["AMAZON", "AMZN MKTP", "AMAZON MKTPLACE"], code: "7400", recurring: false, category: "supplies", taxDoc: "NOT_REQUIRED" },
  { key: "apple", name: "Apple Store", aliases: ["APPLE STORE", "APPLE.COM"], code: "1500", recurring: false, category: "equipment", taxDoc: "NOT_REQUIRED" },
  { key: "jetbrains", name: "JetBrains s.r.o.", aliases: ["JETBRAINS", "JETBRAINS ANNUAL"], code: "7000", recurring: false, category: "software", country: "CZ", taxDoc: "NOT_REQUIRED" },
  { key: "figma", name: "Figma, Inc.", aliases: ["FIGMA"], code: "7000", recurring: false, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "bhphoto", name: "B&H Photo Video", aliases: ["B&H PHOTO", "B&H PHOTO VIDEO"], code: "7400", recurring: false, category: "supplies", taxDoc: "NOT_REQUIRED" },
  { key: "vercel", name: "Vercel Inc.", aliases: ["VERCEL", "VERCEL PRO"], code: "7000", recurring: false, category: "software", taxDoc: "NOT_REQUIRED" },
  { key: "dell", name: "Dell Business", aliases: ["DELL BUSINESS", "DELL BUSINESS ONLINE"], code: "1500", recurring: false, category: "equipment", taxDoc: "NOT_REQUIRED" },
  { key: "bistrolune", name: "Bistro Lune", aliases: ["BISTRO LUNE"], code: "7300", recurring: false, category: "meals", taxDoc: "NOT_REQUIRED" },
  { key: "saltiron", name: "Salt & Iron", aliases: ["SALT & IRON", "SALT AND IRON"], code: "7300", recurring: false, category: "meals", taxDoc: "NOT_REQUIRED" },
  { key: "cafes", name: "Assorted Cafés & Restaurants", aliases: ["CAFE", "RESTAURANT"], code: "7300", recurring: false, category: "meals", taxDoc: "NOT_REQUIRED" },
  { key: "pixelforge", name: "Pixel Forge Design (sole proprietor)", aliases: ["PIXEL FORGE DESIGN", "PIXEL FORGE"], code: "6050", recurring: false, category: "contractor", taxDoc: "UNKNOWN" },
  { key: "venmo", name: "Venmo (payee unknown)", aliases: ["VENMO PAYMENT", "VENMO"], recurring: false, category: "unknown", taxDoc: "UNKNOWN" },
  { key: "unknownsq", name: "Unknown merchant (SQ *)", aliases: ["SQ *UNKNOWN"], recurring: false, category: "unknown", taxDoc: "UNKNOWN" },
];

function buildVendors(start: ISODate): Record<string, Vendor> {
  const out: Record<string, Vendor> = {};
  for (const v of VENDOR_SPECS) {
    out[v.key] = {
      id: sid("vend", v.key),
      name: v.name,
      normalizedNames: v.aliases,
      defaultAccountId: v.code ? acct(v.code) : undefined,
      paymentTermsDays: v.key === "coworking" ? 7 : v.key === "cpa" ? 30 : undefined,
      isRecurring: v.recurring,
      category: v.category,
      country: v.country ?? "US",
      taxDocStatus: v.taxDoc,
      active: true,
      createdAt: ts(start, 9),
      approvedBy: v.taxDoc === "UNKNOWN" ? undefined : "user_finance_operator",
    };
  }
  return out;
}

function cnReviewFields(workerKey: string): ConfigField[] {
  return internationalReviewFields(workerKey, { synthetic: true, reviewer: "ATTORNEY" });
}

function buildWorkers(start: ISODate): Refs["workers"] {
  const usBase = { country: "US", workerType: "EMPLOYEE" as const, classificationStatus: "CONFIRMED" as const, startDate: start, payMethod: "PAYROLL_PROVIDER" as const, documentIds: [] as string[], isSynthetic: true };
  const owner: Worker = {
    ...usBase,
    id: sid("wrk", "owner"),
    displayName: "Avery Lin",
    roleTitle: "CEO / Founder",
    compensation: { type: "SALARY", amount: money(3000), currency: "USD", period: "MONTHLY", basis: "GROSS", status: "PROFESSIONAL_REVIEW_REQUIRED", note: "proposed; reasonable compensation is a professional judgment" },
    isOwner: true,
    relatedParty: true,
    relatedPartyNote: "Sole shareholder and officer.",
  };
  const finance: Worker = {
    ...usBase,
    id: sid("wrk", "finance"),
    displayName: "Jordan Reyes",
    roleTitle: "Finance Operator",
    compensation: { type: "SALARY", amount: money(3000), currency: "USD", period: "MONTHLY", basis: "GROSS", status: "UNCONFIRMED" },
    isOwner: false,
    relatedParty: true,
    relatedPartyNote: "Fiancée of the owner — related-party compensation review.",
  };
  const engineer: Worker = {
    ...usBase,
    id: sid("wrk", "engineer"),
    displayName: "Sam Okafor",
    roleTitle: "Software Engineer",
    compensation: { type: "SALARY", amount: money(5500), currency: "USD", period: "MONTHLY", basis: "GROSS", status: "CONFIRMED", note: "Synthetic lab figure." },
    isOwner: false,
    relatedParty: false,
  };
  const cn = [
    { key: "cn1", name: "Wei Zhang", title: "ML Engineer (China-based)" },
    { key: "cn2", name: "Chen Yu", title: "Data Annotation Lead (China-based)" },
  ].map<Worker>((w) => ({
    id: sid("wrk", w.key),
    displayName: w.name,
    roleTitle: w.title,
    country: "CN",
    workerType: "UNRESOLVED",
    classificationStatus: "UNRESOLVED_PROFESSIONAL_REVIEW",
    compensation: { type: "CONTRACT", amount: money(1500), currency: "USD", period: "MONTHLY", basis: "CONTRACT_FEE", status: "UNCONFIRMED", note: "Lab number only — the 1,500 monthly figure is not a confirmed contract term." },
    startDate: start,
    isOwner: false,
    relatedParty: false,
    payMethod: "INTERNATIONAL_PLATFORM",
    documentIds: [],
    internationalReview: {
      status: "INCOMPLETE_CROSS_BORDER_PROFESSIONAL_REVIEW_REQUIRED",
      fields: cnReviewFields(w.key),
      reviewerRole: "ATTORNEY",
      notes: ["Employment vs. contractor status is unresolved; payments are recorded to 6060 pending professional review.", "No W-9 / W-8 documentation on file."],
    },
    isSynthetic: true,
  }));
  return { owner, finance, engineer, cn };
}

type Refs = GenContext["refs"];

export function buildCompany(ctx: GenContext): void {
  const ds = ctx.ds;
  const start: ISODate = `${ctx.startMonth}-01`;
  ds.accounts = buildChartOfAccounts();

  const checking = { id: sid("bank", "checking"), name: "Operating Checking", institution: "Northgate Community Bank (SYNTHETIC)", accountType: "CHECKING" as const, last4: "4410", currency: "USD", glAccountId: acct("1000"), isSynthetic: true, openedDate: addMonths(start, -1) };
  const savings = { id: sid("bank", "savings"), name: "Business Savings / Reserve", institution: "Northgate Community Bank (SYNTHETIC)", accountType: "SAVINGS" as const, last4: "4428", currency: "USD", glAccountId: acct("1010"), isSynthetic: true, openedDate: addMonths(start, -1) };
  const card = { id: sid("card", "business"), name: "Business Visa", issuer: "Northgate Card Services (SYNTHETIC)", last4: "7731", currency: "USD", glAccountId: acct("2050"), isSynthetic: true, paymentDueDay: 5 };
  ds.bankAccounts.push(checking, savings);
  ds.cards.push(card);

  const vendors = buildVendors(start);
  ds.vendors.push(...Object.values(vendors));

  const harbor: Customer = {
    id: sid("cust", "harbor"),
    name: "Harbor Analytics Group",
    paymentTermsDays: 15,
    country: "US",
    relatedParty: true,
    relatedPartyNote: "payer associated with CEO's father — related-party review",
    active: true,
  };
  const meridian: Customer = { id: sid("cust", "meridian"), name: "Meridian Robotics Co.", paymentTermsDays: 30, country: "US", relatedParty: false, active: true };
  ds.customers.push(harbor, meridian);

  const workers = buildWorkers(start);
  ds.workers.push(workers.owner, workers.finance, workers.engineer, ...workers.cn);

  ctx.refs = { checking, savings, card, vendors, customers: { harbor, meridian }, workers };
}
