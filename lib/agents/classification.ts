/**
 * Rule-based transaction classification engine (no model). Deterministic:
 *   1. merchant normalization (strip store numbers, "*", trailing digits, punctuation)
 *   2. vendor lookup in dataset.vendors normalizedNames → vendor.defaultAccountId
 *   3. keyword → account code map
 *   4. flags: POSSIBLE_PERSONAL (meals on weekends / no receipt / no business purpose),
 *      LARGE_UNUSUAL (equipment ≥ 2,500), TRANSFER, REFUND, POSSIBLE_DUPLICATE, NEW_MERCHANT
 *   5. confidence scoring; CANNOT_CLASSIFY for peer-to-peer / unknown merchants.
 * Also: duplicate detection and transfer matching over a dataset.
 */
import { ACCT, accountIdForCode } from "@/lib/accounting/chart-of-accounts";
import { daysBetween, isWeekend, monthKey } from "@/lib/core/dates";
import { D, abs, eq, gte, money } from "@/lib/core/money";
import type { CompanyDataset, DecimalString, ID, ISODate, Transaction, TransactionFlag, Vendor } from "@/lib/core/types";

export const EQUIPMENT_CAPITALIZATION_THRESHOLD: DecimalString = "2500.0000";
export const DUPLICATE_WINDOW_DAYS = 7;
export const TRANSFER_WINDOW_DAYS = 3;

export interface ClassificationInput {
  description: string;
  amount?: DecimalString | number | null;
  date?: ISODate;
  merchant?: string;
  sourceKind?: "BANK" | "CARD";
  hasReceipt?: boolean;
  notes?: string;
  counterpartyVendorId?: ID;
}

export type ClassificationStatus = "SUGGESTED" | "UNCATEGORIZED";

export interface ClassificationResult {
  accountCode: string | null;
  accountId: ID | null;
  status: ClassificationStatus;
  confidence: number;
  flags: TransactionFlag[];
  reason: string;
  merchantNormalized: string;
  vendorId: ID | null;
  /** Rule that produced the code (vendor | keyword | fallback). */
  rule: string;
  /** True when the category is a known recurring approved pattern for this vendor. */
  recurringApproved: boolean;
  escalation: "CANNOT_CLASSIFY" | null;
}

/** Strip store numbers, "*", trailing digits/hashes and noise from a raw bank description. */
export function normalizeMerchant(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\b(POS|PURCHASE|DEBIT|CREDIT|CARD|PAYMENT|ACH|ONLINE|RECURRING|AUTOPAY|CHECKCARD|VISA|MASTERCARD|TST|SQ|SP|PP|PAYPAL)\s*\*?\s*/g, " ")
    .replace(/\*/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\b[A-Z]{2}\s*$/g, " ")
    .replace(/[^A-Z&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface KeywordRule {
  code: string;
  patterns: RegExp[];
  label: string;
  confidence: number;
}

/** Keyword → account code map. Order matters: first match wins. */
export const KEYWORD_RULES: KeywordRule[] = [
  { code: ACCT.COGS_AI_API, label: "AI model / API usage", confidence: 0.9, patterns: [/\bopenai\b/i, /\banthropic\b/i, /\bclaude\b/i, /\bapi usage\b/i, /\bhugging ?face\b/i, /\breplicate\b/i] },
  { code: ACCT.COGS_CLOUD, label: "Cloud & compute", confidence: 0.9, patterns: [/\baws\b/i, /\bamazon web services\b/i, /\bgoogle cloud\b/i, /\bgcp\b/i, /\bazure\b/i, /\bdigital ?ocean\b/i, /\bcloudflare\b/i, /\bvercel\b/i, /\bhetzner\b/i] },
  { code: ACCT.SOFTWARE, label: "Software subscriptions", confidence: 0.88, patterns: [/\bgithub\b/i, /\bnotion\b/i, /\bslack\b/i, /\bzoom\b/i, /\badobe\b/i, /\bfigma\b/i, /\bjetbrains\b/i, /\bgoogle\s*(workspace|gsuite)\b/i, /\bmicrosoft\s*365\b/i, /\bdropbox\b/i, /\batlassian\b/i, /\bjira\b/i, /\blinear\b/i, /\b1password\b/i, /\bcanva\b/i, /\bsubscription\b/i, /\bsaas\b/i] },
  { code: ACCT.PAYROLL_FEES, label: "Payroll service fees", confidence: 0.85, patterns: [/\b(gusto|paystream|rippling|justworks|adp)\b.*\b(fee|service)\b/i, /\bpayroll (service )?fee/i] },
  { code: ACCT.SALARIES, label: "Payroll", confidence: 0.85, patterns: [/\bpayroll\b/i, /\bgusto\b/i, /\bpaystream\b/i, /\brippling\b/i, /\bjustworks\b/i, /\bnet pay\b/i, /\bdirect dep/i] },
  { code: ACCT.FED_PAYROLL_TAX_PAYABLE, label: "Federal payroll tax remittance", confidence: 0.85, patterns: [/\birs\b/i, /\busataxpymt\b/i, /\beftps\b/i, /\bus treasury\b/i, /\b941\b/] },
  { code: ACCT.STATE_PAYROLL_TAX_PAYABLE, label: "State payroll tax remittance", confidence: 0.85, patterns: [/\bedd\b/i, /\bemployment development\b/i, /\bde ?9/i] },
  { code: ACCT.STATE_TAXES, label: "State franchise / entity tax", confidence: 0.9, patterns: [/\bfranchise tax\b/i, /\bftb\b/i, /\bfranchise tax board\b/i, /\bsecretary of state\b/i] },
  { code: ACCT.RENT, label: "Rent & coworking", confidence: 0.88, patterns: [/\bcoworking\b/i, /\bwework\b/i, /\bregus\b/i, /\brent\b/i, /\blease\b/i, /\boffice space\b/i] },
  { code: ACCT.UTILITIES, label: "Utilities & internet", confidence: 0.85, patterns: [/\binternet\b/i, /\bfiber\b/i, /\bcomcast\b/i, /\bxfinity\b/i, /\bat&t\b/i, /\butility\b/i, /\bpg&e\b/i, /\belectric\b/i] },
  { code: ACCT.TELECOM, label: "Telephone", confidence: 0.85, patterns: [/\bmobile\b/i, /\bwireless\b/i, /\bverizon\b/i, /\bt-mobile\b/i, /\bphone\b/i] },
  { code: ACCT.INSURANCE, label: "Insurance", confidence: 0.88, patterns: [/\binsurance\b/i, /\bhartline\b/i, /\bhiscox\b/i, /\bnext insurance\b/i] },
  { code: ACCT.PROFESSIONAL_FEES, label: "Professional fees", confidence: 0.88, patterns: [/\bcpa\b/i, /\baccounting\b/i, /\btax (&|and) advisory\b/i, /\blaw (firm|llp|group)\b/i, /\blegal\b/i, /\battorney\b/i, /\bkestrel\b/i] },
  { code: ACCT.MEALS, label: "Meals", confidence: 0.75, patterns: [/\brestaurant\b/i, /\bbistro\b/i, /\bgrill\b/i, /\bcaf[eé]\b/i, /\bcoffee\b/i, /\bstarbucks\b/i, /\bdoordash\b/i, /\bubereats\b/i, /\bgrubhub\b/i, /\bpizza\b/i, /\bsushi\b/i, /\bkitchen\b/i, /\btaqueria\b/i, /\bdiner\b/i, /\bbakery\b/i, /\bsalt & iron\b/i, /\bbistro lune\b/i] },
  { code: ACCT.TRAVEL, label: "Travel", confidence: 0.85, patterns: [/\bairline\b/i, /\bunited\b/i, /\bdelta\b/i, /\bsouthwest\b/i, /\bhotel\b/i, /\bmarriott\b/i, /\bhilton\b/i, /\bairbnb\b/i, /\buber\b(?!\s*eats)/i, /\blyft\b/i, /\bamtrak\b/i, /\bparking\b/i] },
  { code: ACCT.MARKETING, label: "Marketing & advertising", confidence: 0.85, patterns: [/\bgoogle ads\b/i, /\bfacebook ads\b/i, /\bmeta ads\b/i, /\blinkedin\b.*\bads?\b/i, /\badvertis/i, /\bmarketing\b/i, /\bmailchimp\b/i] },
  { code: ACCT.OFFICE_SUPPLIES, label: "Office supplies & small equipment", confidence: 0.8, patterns: [/\bamazon\b/i, /\bamzn\b/i, /\bstaples\b/i, /\boffice depot\b/i, /\bb&h\b/i, /\bsupplies\b/i] },
  { code: ACCT.BANK_FEES, label: "Bank & merchant fees", confidence: 0.9, patterns: [/\bbank fee\b/i, /\bservice charge\b/i, /\bwire fee\b/i, /\bstripe fee\b/i, /\bmonthly fee\b/i, /\bmerchant fee\b/i] },
  { code: ACCT.EDUCATION, label: "Education & training", confidence: 0.8, patterns: [/\bcourse\b/i, /\budemy\b/i, /\bcoursera\b/i, /\bconference\b/i, /\btraining\b/i, /\bo'reilly\b/i] },
  { code: ACCT.LICENSES, label: "Licenses, permits & filing fees", confidence: 0.8, patterns: [/\blicense\b/i, /\bpermit\b/i, /\bfiling fee\b/i, /\bregistration\b/i] },
  { code: ACCT.DUES, label: "Dues & subscriptions (non-software)", confidence: 0.75, patterns: [/\bmembership\b/i, /\bchamber of commerce\b/i, /\bdues\b/i] },
  { code: ACCT.INTEREST_EXPENSE, label: "Interest expense", confidence: 0.85, patterns: [/\binterest charge\b/i, /\bfinance charge\b/i] },
  { code: ACCT.CONTRACTORS_DOMESTIC, label: "Contractor payments", confidence: 0.7, patterns: [/\bcontractor\b/i, /\bfreelance/i, /\bupwork\b/i, /\bfiverr\b/i, /\bdesign\b.*\b(llc|studio|sole)\b/i] },
  { code: ACCT.INTL_WORKERS, label: "International worker payments", confidence: 0.75, patterns: [/\bintl payment platform\b/i, /\bglobalpay\b/i, /\bdeel\b/i, /\bremote\.com\b/i, /\bwise\b.*\b(intl|international)\b/i, /\binternational (payment|transfer)\b/i] },
];

const EQUIPMENT_PATTERNS = [/\bapple store\b/i, /\bapple\.com\b/i, /\bdell\b/i, /\blenovo\b/i, /\bbest buy\b/i, /\bmicro ?center\b/i, /\bb&h photo\b/i, /\bnewegg\b/i, /\bmacbook\b/i, /\blaptop\b/i];
const TRANSFER_PATTERNS = [/\btransfer\b/i, /\bxfer\b/i, /\bonline transfer\b/i, /\bto savings\b/i, /\bfrom savings\b/i, /\bto checking\b/i, /\bcard payment\b/i, /\bpayment thank you\b/i, /\bautopay payment\b/i];
const P2P_PATTERNS = [/\bvenmo\b/i, /\bzelle\b/i, /\bcash app\b/i, /\bcashapp\b/i, /\bpaypal\b(?!.*\b(fee|subscription)\b)/i, /\bsq \*unknown\b/i, /\bunknown merchant\b/i, /\batm withdrawal\b/i, /\bcheck \d+\b/i, /\bcheck paid\b/i];
const REFUND_PATTERNS = [/\brefund\b/i, /\breturn\b/i, /\bcredit memo\b/i, /\breversal\b/i];
const WEEKEND_HINTS = [/\b(saturday|sunday|weekend|brunch)\b/i];
const INTERNATIONAL_HINTS = [/\bchina\b/i, /\bchinese\b/i, /\(cn\)/i, /\bcn\b/, /\binternational\b/i, /\boverseas\b/i, /\babroad\b/i, /\bcross[- ]border\b/i, /\bforeign\b/i, /\bintl\b/i];
const DUPLICATE_HINTS = [/\balready (posted|charged|paid|recorded|billed)\b/i, /\bidentical\b/i, /\bduplicate\b/i, /\bsecond (charge|time)\b/i, /\bcharged twice\b/i, /\btwice (this|in the same) month\b/i, /\bdouble[- ]charg/i];
const PERSONAL_HINTS = [/\bpersonal\b/i, /\bfamily\b/i, /\bkids?\b/i, /\bwife\b/i, /\bhusband\b/i, /\bspouse\b/i, /\bgroceries\b/i, /\bwhole foods\b/i, /\btrader joe/i, /\bsafeway\b/i, /\bgym\b/i, /\bnetflix\b/i, /\bspotify\b/i, /\bapartment\b/i, /\bhome\b/i, /\bvacation\b/i, /\bdisney\b/i, /\bbirthday\b/i];
const DISTRIBUTION_HINTS = [/\bowner draw\b/i, /\bdistribution\b/i, /\bshareholder\b/i, /\bto owner\b/i];

function findVendor(dataset: CompanyDataset, normalized: string, raw: string): Vendor | undefined {
  const hay = `${normalized} ${raw.toUpperCase()}`;
  let best: { v: Vendor; len: number } | undefined;
  for (const v of dataset.vendors) {
    for (const alias of [v.name, ...v.normalizedNames]) {
      const a = normalizeMerchant(alias);
      if (a.length >= 3 && hay.includes(a) && (!best || a.length > best.len)) best = { v, len: a.length };
    }
  }
  return best?.v;
}

function approvedPatternFor(dataset: CompanyDataset, vendorId: ID | undefined, normalized: string): { accountId: ID; count: number } | null {
  const counts = new Map<ID, number>();
  for (const t of dataset.transactions) {
    if (t.category.status !== "APPROVED" || !t.category.accountId) continue;
    const sameVendor = vendorId && t.counterpartyRef?.type === "VENDOR" && t.counterpartyRef.id === vendorId;
    const sameMerchant = normalized && normalizeMerchant(t.merchantNormalized ?? t.descriptionRaw) === normalized;
    if (sameVendor || sameMerchant) counts.set(t.category.accountId, (counts.get(t.category.accountId) ?? 0) + 1);
  }
  let best: { accountId: ID; count: number } | null = null;
  for (const [accountId, count] of counts) if (!best || count > best.count) best = { accountId, count };
  return best && best.count >= 2 ? best : null;
}

function codeOf(dataset: CompanyDataset, accountId: ID): string | null {
  return dataset.accounts.find((a) => a.id === accountId)?.code ?? null;
}

export function classifyTransaction(dataset: CompanyDataset, input: ClassificationInput): ClassificationResult {
  const raw = `${input.merchant ?? ""} ${input.description ?? ""}`.trim();
  const normalized = normalizeMerchant(input.merchant ?? input.description ?? "");
  const hay = `${raw} ${input.notes ?? ""}`;
  const amount = input.amount === null || input.amount === undefined || input.amount === "" ? null : money(input.amount);
  const flags = new Set<TransactionFlag>();
  const reasons: string[] = [];

  const vendor = input.counterpartyVendorId ? dataset.vendors.find((v) => v.id === input.counterpartyVendorId) : findVendor(dataset, normalized, raw);
  const isInflow = amount !== null && D(amount).gt(0);
  const isCardCredit = input.sourceKind === "CARD" && isInflow;
  const ownerNames = dataset.workers.filter((w) => w.isOwner).flatMap((w) => w.displayName.replace(/\(.*?\)/g, "").split(/\s+/).filter((t) => t.length > 2).map((t) => t.toUpperCase()));
  const rawWords = new Set(raw.toUpperCase().split(/[^A-Z]+/).filter(Boolean));
  const namesOwner = ownerNames.length > 0 && ownerNames.every((n) => rawWords.has(n));
  const ownerTransfer = /\btransfer\b/i.test(hay) && (namesOwner || /\bpersonal\b/i.test(hay) || /\bowner\b/i.test(hay));

  // Transfers between company accounts (a transfer to the owner is a distribution, handled below)
  if (!ownerTransfer && TRANSFER_PATTERNS.some((p) => p.test(hay)) && !P2P_PATTERNS.some((p) => p.test(hay))) {
    flags.add("TRANSFER");
    return {
      accountCode: null,
      accountId: null,
      status: "UNCATEGORIZED",
      confidence: 0.85,
      flags: [...flags],
      reason: "Looks like a transfer between company accounts (or a card payment); it is matched to its counterpart rather than expensed.",
      merchantNormalized: normalized,
      vendorId: vendor?.id ?? null,
      rule: "transfer",
      recurringApproved: false,
      escalation: null,
    };
  }

  // Refunds: positive amount on a card / credit from a known merchant
  if (isCardCredit || (isInflow && REFUND_PATTERNS.some((p) => p.test(hay)))) {
    flags.add("REFUND");
    const prior = amount ? findPriorCharge(dataset, normalized, amount, input.date) : undefined;
    const priorCode = prior?.category.accountId ? codeOf(dataset, prior.category.accountId) : null;
    const keyword = KEYWORD_RULES.find((r) => r.patterns.some((p) => p.test(hay)));
    const code = priorCode ?? (vendor?.defaultAccountId ? codeOf(dataset, vendor.defaultAccountId) : null) ?? keyword?.code ?? null;
    return {
      accountCode: code,
      accountId: code ? accountIdForCode(code) : null,
      status: code ? "SUGGESTED" : "UNCATEGORIZED",
      confidence: prior ? 0.9 : code ? 0.7 : 0.3,
      flags: [...flags],
      reason: prior ? `Refund matching prior charge ${prior.id} (${prior.date}, ${prior.amount}); credited back to the same account.` : code ? "Refund credited back to the merchant's usual expense account (no prior charge found)." : "Refund with no identifiable original charge.",
      merchantNormalized: normalized,
      vendorId: vendor?.id ?? null,
      rule: prior ? "refund:prior-charge" : "refund",
      recurringApproved: false,
      escalation: code ? null : "CANNOT_CLASSIFY",
    };
  }

  // Owner distributions / draws
  if (ownerTransfer || DISTRIBUTION_HINTS.some((p) => p.test(hay))) {
    flags.add("RELATED_PARTY");
    flags.add("REVIEW_REQUIRED");
    if (/\bpersonal\b/i.test(hay)) flags.add("POSSIBLE_PERSONAL");
    if (amount !== null && D(abs(amount)).mod(500).isZero()) flags.add("LARGE_UNUSUAL");
    return {
      accountCode: ACCT.DISTRIBUTIONS,
      accountId: accountIdForCode(ACCT.DISTRIBUTIONS),
      status: "SUGGESTED",
      confidence: 0.6,
      flags: [...flags],
      reason: "Payment to the owner: suggested as a shareholder distribution (restricted account); owner and CPA review required — could also be reimbursement or loan repayment.",
      merchantNormalized: normalized,
      vendorId: null,
      rule: "distribution",
      recurringApproved: false,
      escalation: null,
    };
  }

  // Peer-to-peer / unknown payee → cannot classify
  if (P2P_PATTERNS.some((p) => p.test(hay)) && !vendor?.defaultAccountId) {
    flags.add("UNCATEGORIZED");
    flags.add("REVIEW_REQUIRED");
    if (!vendor) flags.add("NEW_MERCHANT");
    return {
      accountCode: null,
      accountId: null,
      status: "UNCATEGORIZED",
      confidence: 0.2,
      flags: [...flags],
      reason: "Peer-to-peer or unidentified payee: the counterparty and business purpose are unknown, so no category can be suggested without invention.",
      merchantNormalized: normalized,
      vendorId: vendor?.id ?? null,
      rule: "p2p-unknown",
      recurringApproved: false,
      escalation: "CANNOT_CLASSIFY",
    };
  }

  // Equipment capitalization
  const isEquipmentMerchant = EQUIPMENT_PATTERNS.some((p) => p.test(hay)) || vendor?.category === "equipment";
  if (isEquipmentMerchant && amount !== null && gte(abs(amount), EQUIPMENT_CAPITALIZATION_THRESHOLD)) {
    flags.add("LARGE_UNUSUAL");
    if (input.hasReceipt === false) flags.add("MISSING_RECEIPT");
    return {
      accountCode: ACCT.COMPUTER_EQUIPMENT,
      accountId: accountIdForCode(ACCT.COMPUTER_EQUIPMENT),
      status: "SUGGESTED",
      confidence: 0.8,
      flags: [...flags],
      reason: `Equipment purchase of ${abs(amount)} at/above the ${EQUIPMENT_CAPITALIZATION_THRESHOLD} capitalization threshold (lab default, UNCONFIRMED): suggested as a fixed asset; capitalization policy and tax treatment need CPA confirmation.`,
      merchantNormalized: normalized,
      vendorId: vendor?.id ?? null,
      rule: "equipment:capitalize",
      recurringApproved: false,
      escalation: null,
    };
  }

  // Vendor default account
  let code: string | null = null;
  let rule = "fallback";
  let confidence = 0.3;
  let label = "";
  if (vendor?.defaultAccountId) {
    code = codeOf(dataset, vendor.defaultAccountId);
    rule = "vendor:default";
    confidence = 0.9;
    label = vendor.name;
  } else {
    const kw = KEYWORD_RULES.find((r) => r.patterns.some((p) => p.test(hay)));
    if (kw) {
      code = kw.code;
      rule = `keyword:${kw.label}`;
      confidence = kw.confidence;
      label = kw.label;
    }
  }
  if (isEquipmentMerchant && !code) {
    code = ACCT.OFFICE_SUPPLIES;
    rule = "equipment:below-threshold";
    confidence = 0.75;
    label = "Small equipment below capitalization threshold";
  }
  if (!vendor) flags.add("NEW_MERCHANT");
  const pattern = approvedPatternFor(dataset, vendor?.id, normalized);
  const recurringApproved = Boolean(pattern && code && codeOf(dataset, pattern.accountId) === code);
  if (recurringApproved) {
    confidence = Math.min(0.98, confidence + 0.08);
    reasons.push(`Matches ${pattern!.count} previously approved categorizations of this merchant.`);
  }

  // Personal / mixed-use heuristics
  const personalHint = PERSONAL_HINTS.some((p) => p.test(hay));
  const isMeal = code === ACCT.MEALS;
  const weekend = (input.date ? isWeekend(input.date) : false) || WEEKEND_HINTS.some((p) => p.test(hay));
  const noPurpose = !(input.notes && /\b(client|customer|meeting|team|prospect|business purpose|attendees?|lunch with|dinner with|recruit|interview|conference|roadmap|review with)\b/i.test(input.notes));
  if (personalHint || (isMeal && (weekend || input.hasReceipt === false || noPurpose))) {
    flags.add("POSSIBLE_PERSONAL");
    flags.add("REVIEW_REQUIRED");
    confidence = Math.min(confidence, 0.55);
    if (personalHint) reasons.push("Description or notes suggest a personal expense; personal costs are never booked as business.");
    if (isMeal) reasons.push(`Meal on ${weekend ? "a weekend" : "a weekday"}${input.hasReceipt === false ? ", no receipt" : ""}${noPurpose ? ", no documented business purpose (attendees/purpose required by the meals policy)" : ""}.`);
  }
  const undocumentedMeal = isMeal && noPurpose && (weekend || input.hasReceipt === false);
  if ((personalHint && (!code || code === ACCT.MEALS || code === ACCT.TRAVEL || code === ACCT.OFFICE_SUPPLIES)) || undocumentedMeal) {
    code = ACCT.PERSONAL_REVIEW;
    rule = "personal:review";
    confidence = 0.6;
    label = "Non-deductible / personal (review)";
    reasons.push(`Suggested ${ACCT.PERSONAL_REVIEW} Non-Deductible / Personal (Review) pending documented business purpose; never treated as deductible on instruction alone.`);
  }
  if (input.hasReceipt === false) flags.add("MISSING_RECEIPT");
  if (amount !== null && gte(abs(amount), "5000.0000") && !recurringApproved) flags.add("LARGE_UNUSUAL");
  if (code === ACCT.INTL_WORKERS || INTERNATIONAL_HINTS.some((p) => p.test(hay))) {
    flags.add("INTERNATIONAL");
    flags.add("REVIEW_REQUIRED");
    if (code === ACCT.INTL_WORKERS) reasons.push("Payment to an international worker: held in 6060 (classification pending) until the attorney/CPA review resolves the worker's status.");
  }
  if (DUPLICATE_HINTS.some((p) => p.test(input.notes ?? ""))) {
    flags.add("POSSIBLE_DUPLICATE");
    flags.add("REVIEW_REQUIRED");
    reasons.push("Notes indicate the same charge was already posted this month; flagged as a possible duplicate.");
  }
  if (amount !== null && input.date) {
    const target = abs(amount);
    const dup = dataset.transactions.find((t) => t.date !== input.date || t.descriptionRaw !== input.description ? eq(abs(t.amount), target) && normalizeMerchant(t.merchantNormalized ?? t.descriptionRaw) === normalized && Math.abs(daysBetween(t.date, input.date!)) <= DUPLICATE_WINDOW_DAYS && !(t.date === input.date && t.descriptionRaw === input.description) : false);
    if (dup) {
      flags.add("POSSIBLE_DUPLICATE");
      flags.add("REVIEW_REQUIRED");
      reasons.push(`Matches ${dup.id} (${dup.date}, ${dup.amount}) within ${DUPLICATE_WINDOW_DAYS} days; possible duplicate.`);
    }
  }

  if (!code) {
    flags.add("UNCATEGORIZED");
    flags.add("REVIEW_REQUIRED");
    return {
      accountCode: null,
      accountId: null,
      status: "UNCATEGORIZED",
      confidence: 0.2,
      flags: [...flags],
      reason: "No vendor match and no keyword rule matched; the transaction needs a business purpose before it can be categorized.",
      merchantNormalized: normalized,
      vendorId: vendor?.id ?? null,
      rule: "fallback",
      recurringApproved: false,
      escalation: "CANNOT_CLASSIFY",
    };
  }
  reasons.unshift(rule === "vendor:default" ? `Known vendor ${label} with a default account.` : `Keyword rule "${label}" matched the description.`);
  return {
    accountCode: code,
    accountId: accountIdForCode(code),
    status: "SUGGESTED",
    confidence: Math.round(confidence * 100) / 100,
    flags: [...flags],
    reason: reasons.join(" "),
    merchantNormalized: normalized,
    vendorId: vendor?.id ?? null,
    rule,
    recurringApproved,
    escalation: null,
  };
}

function findPriorCharge(dataset: CompanyDataset, normalized: string, amount: DecimalString, date?: ISODate): Transaction | undefined {
  const target = abs(amount);
  return dataset.transactions
    .filter((t) => D(t.amount).lt(0) && eq(abs(t.amount), target) && normalizeMerchant(t.merchantNormalized ?? t.descriptionRaw) === normalized && (!date || t.date <= date))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export interface DuplicateCandidate {
  transactionId: ID;
  duplicateOfId: ID;
  merchant: string;
  amount: DecimalString;
  daysApart: number;
  kind: "SAME_MERCHANT_AMOUNT_WINDOW" | "SUBSCRIPTION_TWICE_IN_MONTH";
  confidence: number;
}

export function detectDuplicates(dataset: CompanyDataset, opts: { windowDays?: number; transactionIds?: ID[] } = {}): DuplicateCandidate[] {
  const window = opts.windowDays ?? DUPLICATE_WINDOW_DAYS;
  const scope = opts.transactionIds ? new Set(opts.transactionIds) : null;
  const txs = dataset.transactions.filter((t) => !t.flags.includes("TRANSFER") && !t.transferPairId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const recurringVendorIds = new Set(dataset.vendors.filter((v) => v.isRecurring).map((v) => v.id));
  const out: DuplicateCandidate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < txs.length; i++) {
    const a = txs[i];
    const na = normalizeMerchant(a.merchantNormalized ?? a.descriptionRaw);
    for (let j = i + 1; j < txs.length; j++) {
      const b = txs[j];
      if (scope && !scope.has(a.id) && !scope.has(b.id)) continue;
      const days = daysBetween(a.date, b.date);
      if (days > 31) break;
      const nb = normalizeMerchant(b.merchantNormalized ?? b.descriptionRaw);
      if (na !== nb || !na) continue;
      const sameAmount = eq(a.amount, b.amount);
      const key = `${a.id}|${b.id}`;
      if (seen.has(key)) continue;
      const vendorId = a.counterpartyRef?.type === "VENDOR" ? a.counterpartyRef.id : undefined;
      const subscription = (vendorId && recurringVendorIds.has(vendorId)) || KEYWORD_RULES.slice(0, 3).some((r) => r.patterns.some((p) => p.test(na)));
      if (sameAmount && days <= window) {
        seen.add(key);
        out.push({ transactionId: b.id, duplicateOfId: a.id, merchant: na, amount: a.amount, daysApart: days, kind: "SAME_MERCHANT_AMOUNT_WINDOW", confidence: days === 0 ? 0.95 : 0.85 });
      } else if (subscription && sameAmount && monthKey(a.date) === monthKey(b.date)) {
        seen.add(key);
        out.push({ transactionId: b.id, duplicateOfId: a.id, merchant: na, amount: a.amount, daysApart: days, kind: "SUBSCRIPTION_TWICE_IN_MONTH", confidence: 0.8 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Transfer matching
// ---------------------------------------------------------------------------

export interface TransferPair {
  outTransactionId: ID;
  inTransactionId: ID;
  amount: DecimalString;
  daysApart: number;
  fromSourceAccountId: ID;
  toSourceAccountId: ID;
  confidence: number;
}

export function matchTransfers(dataset: CompanyDataset, opts: { from?: ISODate; to?: ISODate; windowDays?: number } = {}): { pairs: TransferPair[]; unmatched: ID[] } {
  const window = opts.windowDays ?? TRANSFER_WINDOW_DAYS;
  const inRange = (t: Transaction) => (!opts.from || t.date >= opts.from) && (!opts.to || t.date <= opts.to);
  const candidates = dataset.transactions.filter((t) => inRange(t) && (t.flags.includes("TRANSFER") || TRANSFER_PATTERNS.some((p) => p.test(t.descriptionRaw)) || t.transferPairId));
  const outs = candidates.filter((t) => D(t.amount).lt(0)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const ins = candidates.filter((t) => D(t.amount).gt(0)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const used = new Set<ID>();
  const pairs: TransferPair[] = [];
  for (const o of outs) {
    const match = ins.find((i) => !used.has(i.id) && i.sourceAccountId !== o.sourceAccountId && eq(abs(i.amount), abs(o.amount)) && Math.abs(daysBetween(o.date, i.date)) <= window);
    if (!match) continue;
    used.add(match.id);
    used.add(o.id);
    const days = Math.abs(daysBetween(o.date, match.date));
    pairs.push({ outTransactionId: o.id, inTransactionId: match.id, amount: abs(o.amount), daysApart: days, fromSourceAccountId: o.sourceAccountId, toSourceAccountId: match.sourceAccountId, confidence: days === 0 ? 0.95 : 0.85 });
  }
  const unmatched = candidates.filter((t) => !used.has(t.id) && !t.transferPairId).map((t) => t.id);
  return { pairs, unmatched };
}

// ---------------------------------------------------------------------------
// Exception queue
// ---------------------------------------------------------------------------

export interface ExceptionItem {
  transactionId: ID;
  date: ISODate;
  amount: DecimalString;
  description: string;
  reasons: string[];
  flags: TransactionFlag[];
  status: Transaction["category"]["status"];
}

const EXCEPTION_FLAGS: TransactionFlag[] = ["POSSIBLE_DUPLICATE", "POSSIBLE_PERSONAL", "MISSING_RECEIPT", "LARGE_UNUSUAL", "UNCATEGORIZED", "REVIEW_REQUIRED", "RELATED_PARTY", "INTERNATIONAL"];

export function exceptionQueue(dataset: CompanyDataset, asOf?: ISODate): ExceptionItem[] {
  const out: ExceptionItem[] = [];
  for (const t of dataset.transactions) {
    if (asOf && t.date > asOf) continue;
    const reasons: string[] = [];
    if (t.category.status === "UNCATEGORIZED") reasons.push("uncategorized");
    if (t.category.status === "SUGGESTED" && t.category.confidence < 0.7) reasons.push(`low-confidence suggestion (${t.category.confidence})`);
    for (const f of t.flags) if (EXCEPTION_FLAGS.includes(f)) reasons.push(f.toLowerCase().replace(/_/g, " "));
    if (t.category.accountId === accountIdForCode(ACCT.SUSPENSE)) reasons.push("posted to suspense");
    if (!reasons.length) continue;
    out.push({ transactionId: t.id, date: t.date, amount: t.amount, description: t.descriptionRaw, reasons: [...new Set(reasons)], flags: [...t.flags], status: t.category.status });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.transactionId < b.transactionId ? -1 : 1));
}
