/**
 * Tax question guard — deterministic, keyword/pattern based classification of a tax
 * question into what the system may do with it:
 *  - CALCULATE_WITH_APPROVED_RULE: arithmetic or a lookup using a usable TaxRule
 *  - TAX_LAW_JUDGMENT: requires CPA judgment; the system may gather facts and queue it
 *  - PROHIBITED_AUTONOMOUS: the system must refuse to decide/act and escalate
 */

export type TaxQuestionClass = "CALCULATE_WITH_APPROVED_RULE" | "TAX_LAW_JUDGMENT" | "PROHIBITED_AUTONOMOUS";

export type ProhibitedCategory =
  | "AGGRESSIVE_POSITION"
  | "WORKER_CLASSIFICATION"
  | "ENTITY_ELECTION_CHANGE"
  | "REASONABLE_COMPENSATION_DECISION"
  | "SIGNING_OR_FILING"
  | "RESPONDING_TO_AUTHORITIES"
  | "AMBIGUOUS_PERSONAL_EXPENSE"
  | "UNSUPPORTED_DEDUCTION";

interface PatternGroup<C extends string> {
  category: C;
  patterns: RegExp[];
}

export const PROHIBITED_PATTERNS: PatternGroup<ProhibitedCategory>[] = [
  { category: "AGGRESSIVE_POSITION", patterns: [/\baggressive\b/i, /\bloophole/i, /\b(hide|conceal|under-?report|not report|don'?t report|omit)\b.*\b(income|revenue|cash)\b/i, /\boff the books\b/i, /\bunder the table\b/i, /\bevade|evasion\b/i, /\bwrite off everything\b/i, /\bmake (it|this) (look|appear)\b/i] },
  { category: "WORKER_CLASSIFICATION", patterns: [/\b(classify|treat|reclassify|label)\b.*\b(workers?|contractors?|employees?|1099|w-?2)\b/i, /\b(employee|contractor)\s+(or|vs\.?|versus)\s+(employee|contractor)\b/i, /\b1099\s+(or|vs\.?|versus)\s+w-?2\b/i, /\bw-?2\s+(or|vs\.?|versus)\s+1099\b/i, /\bmisclassif/i, /\bis (he|she|they|this person|[a-z]+) (an? )?(employee|contractor)\b/i, /\b(china|foreign|overseas|international)[\s-]*(based )?(worker|contractor|employee)s?\b.*\b(classif|status|treat)\b/i] },
  { category: "ENTITY_ELECTION_CHANGE", patterns: [/\b(revoke|terminate|make|change|elect|switch to|convert to)\b.*\b(s[\s-]?corp|s election|c[\s-]?corp|partnership|disregarded|llc taxation|entity type)\b/i, /\bform 2553\b/i, /\bform 8832\b/i, /\bchange (the |our )?entity\b/i] },
  { category: "REASONABLE_COMPENSATION_DECISION", patterns: [/\b(set|decide|determine|pick|choose|approve|fix)\b.*\b(owner|officer|my|shareholder)('s)?\s+(salary|wage|compensation|pay)\b/i, /\bhow much should (i|the owner|we) pay (myself|himself|herself|the owner)\b/i, /\breasonable compensation\b.*\b(is|should be|set|decide|amount)\b/i, /\bwhat (salary|wage) (should|is reasonable)\b/i] },
  { category: "SIGNING_OR_FILING", patterns: [/\b(file|e-?file|submit|transmit|send in|lodge)\b.*\b(return|1120-?s|100s|941|940|de ?9|1099|form|filing|extension)\b/i, /\bsign\b.*\b(return|form|document|filing|8879)\b/i, /\bfile (it|them|this|the taxes)\b/i, /\bpay the (irs|ftb|edd|tax)\b/i] },
  { category: "RESPONDING_TO_AUTHORITIES", patterns: [/\b(respond|reply|answer|write|draft a (letter|response))\b.*\b(irs|ftb|franchise tax board|edd|tax authority|auditor|notice|audit letter|cp\d+)\b/i, /\b(irs|ftb|edd)\b.*\b(notice|letter|audit)\b.*\b(respond|reply|answer|handle)\b/i, /\bnegotiate\b.*\b(irs|ftb|edd)\b/i] },
  { category: "AMBIGUOUS_PERSONAL_EXPENSE", patterns: [/\b(deduct|expense|write[\s-]?off|run through the business|put on the business card)\b.*\b(my|personal|family|vacation|wedding|fianc[eé]e?|girlfriend|boyfriend|kids?|home|car|phone|clothes|gym|netflix)\b/i, /\b(personal|mixed|partly personal)\b.*\b(deduct|classify|categorize|business expense)\b/i, /\bcall (it|this) (a )?business (expense|meal|trip)\b/i] },
  { category: "UNSUPPORTED_DEDUCTION", patterns: [/\b(no|without|missing|lost)\s+(a\s+)?(receipt|documentation|invoice|proof|records?)\b.*\b(deduct|expense|claim|write)\b/i, /\b(deduct|claim|expense|write off)\b.*\b(no|without|missing|lost)\s+(a\s+)?(receipt|documentation|invoice|proof|records?)\b/i, /\b(make up|invent|estimate|guess|fabricate|backdate)\b.*\b(receipt|expense|deduction|mileage|number)s?\b/i, /\bround up\b.*\b(deduction|expense)/i] },
];

const JUDGMENT_PATTERNS: RegExp[] = [
  /\b(deductible|deductibility|taxable|tax[\s-]?free|exempt)\b/i,
  /\bcan (i|we|the company) (deduct|claim|expense|write off)\b/i,
  /\bshould (i|we)\b/i,
  /\b(nexus|apportion|sourcing|treaty|withholding requirement|permanent establishment)\b/i,
  /\b(treatment|characteriz|qualif|eligib|allowed|permitted|legal|compliant|compliance)\b/i,
  /\bhome office\b/i,
  /\b(section|§)\s?\d+/i,
  /\b(basis|distribution|dividend|loan to shareholder)\b.*\b(tax|consequence|treat)\b/i,
  /\bwhat (are|is) the rules?\b/i,
  /\b(reasonable compensation|related[\s-]party)\b/i,
];

const CALCULATE_PATTERNS: RegExp[] = [
  /\b(calculate|compute|estimate the amount|how much (is|are|will|do we owe)|what is the amount|total|sum)\b/i,
  /\b(when|what date|which date|by when|due date|deadline)\b.*\b(due|file|deadline|941|940|1120-?s|100s|de ?9|1099|statement of information)\b/i,
  /\b(due|deadline)\b.*\b(when|date)\b/i,
  /\b(rate|wage base|percentage|threshold|limit)\b.*\b(social security|medicare|futa|sdi|sui|ui|ett|franchise|minimum)\b/i,
  /\b(social security|medicare|futa|sdi|sui|ett|franchise|minimum)\b.*\b(rate|wage base|percentage|threshold|limit)\b/i,
  /\b(payroll tax|withholding|employer tax|fica|futa)\b.*\b(amount|calculate|compute|total|for this payroll|for this month)\b/i,
  /\bfranchise tax\b.*\b(amount|calculate|compute|owe)\b/i,
  /\b(project|forecast|accrue|accrual)\b.*\b(tax|liabilit)/i,
];

export interface TaxGuardResult {
  classification: TaxQuestionClass;
  prohibitedCategories: ProhibitedCategory[];
  matched: string[];
  reason: string;
}

export function explainTaxQuestion(text: string): TaxGuardResult {
  const t = text.trim();
  const prohibited: ProhibitedCategory[] = [];
  const matched: string[] = [];
  for (const g of PROHIBITED_PATTERNS) {
    for (const p of g.patterns) {
      if (p.test(t)) {
        if (!prohibited.includes(g.category)) prohibited.push(g.category);
        matched.push(`${g.category}:${p.source.slice(0, 40)}`);
      }
    }
  }
  if (prohibited.length) {
    return { classification: "PROHIBITED_AUTONOMOUS", prohibitedCategories: prohibited, matched, reason: `Prohibited for autonomous handling: ${prohibited.join(", ")}. Escalate to the CPA / owner; the system may only gather facts.` };
  }
  const judgmentHits = JUDGMENT_PATTERNS.filter((p) => p.test(t)).map((p) => `JUDGMENT:${p.source.slice(0, 40)}`);
  const calcHits = CALCULATE_PATTERNS.filter((p) => p.test(t)).map((p) => `CALC:${p.source.slice(0, 40)}`);
  if (judgmentHits.length) {
    return { classification: "TAX_LAW_JUDGMENT", prohibitedCategories: [], matched: judgmentHits, reason: "Requires tax-law judgment; queue for CPA with facts and sources." };
  }
  if (calcHits.length) {
    return { classification: "CALCULATE_WITH_APPROVED_RULE", prohibitedCategories: [], matched: calcHits, reason: "Deterministic calculation or lookup; proceed only with a usable (CURRENT, sourced, reviewed) TaxRule, otherwise escalate." };
  }
  return { classification: "TAX_LAW_JUDGMENT", prohibitedCategories: [], matched: [], reason: "Unrecognized tax question; default to CPA judgment (never guess)." };
}

export function classifyTaxQuestion(text: string): TaxQuestionClass {
  return explainTaxQuestion(text).classification;
}
