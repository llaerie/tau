/**
 * Control guard: detects requests that would violate a financial control BEFORE any tool
 * runs. Detection is pattern-based and deterministic. Every violation carries the control it
 * protects and a compliant alternative the agent can offer instead.
 */
import type { Escalation } from "@/lib/core/contracts";

export type ControlViolationKind =
  | "PERSONAL_AS_BUSINESS"
  | "IGNORE_DOCUMENTATION"
  | "PAYMENT_WITHOUT_APPROVAL"
  | "ALTER_CLOSED_BOOKS"
  | "REASONABLE_COMP_DECISION"
  | "CONCEAL_FROM_PROFESSIONAL"
  | "HIDE_OR_DELETE_RECORDS"
  | "BACKDATE"
  | "FILE_OR_SIGN"
  | "MOVE_MONEY"
  | "MISSTATE_FIGURES"
  | "FALSE_ASSURANCE"
  | "SELF_AUTONOMY"
  | "SELF_APPROVAL";

export interface ControlViolation {
  kind: ControlViolationKind;
  control: string;
  explanation: string;
  compliantAlternative: string;
  matched: string;
}

interface GuardPattern {
  kind: ControlViolationKind;
  patterns: RegExp[];
  control: string;
  explanation: string;
  compliantAlternative: string;
}

const PERSONAL_NOUNS = "apartment|home|house|condo|flat|residence|personal|family|vacation|spouse|wife|husband|kids?|childcare|groceries|gym|netflix|clothes|haircut|dog|pet";

export const GUARD_PATTERNS: GuardPattern[] = [
  {
    kind: "PERSONAL_AS_BUSINESS",
    patterns: [
      new RegExp(`\\b(${PERSONAL_NOUNS})\\b[^.?!]{0,80}\\b(as|to|under|into|categori[sz]e|classif(y|ied)|book|record|code|expense|deduct|write[\\s-]?off)\\b[^.?!]{0,60}\\b(office|rent|business|meals?|travel|expense|deduct|write[\\s-]?off|company)`, "i"),
      new RegExp(`\\b(categori[sz]e|classify|book|record|code|expense|deduct|write[\\s-]?off|put|run|treat)\\b[^.?!]{0,60}\\b(${PERSONAL_NOUNS})\\b[^.?!]{0,60}\\b(as|through|under|to)\\b[^.?!]{0,40}\\b(business|office|company|deductible|expense|meals?|travel)`, "i"),
      /\bpersonal\b[^.?!]{0,40}\b(as|through)\b[^.?!]{0,30}\bbusiness\b/i,
      /\b(my|our)\s+(apartment|home|house)\s+(rent|mortgage|lease)\b[^.?!]{0,60}\b(office|business|rent|expense)/i,
      /\b(apartment|home|house)\s+(rent|mortgage)\b[^.?!]{0,40}\bas\s+(office|business)\b/i,
    ],
    control: "Personal / business separation policy: personal expenses are never categorized as business expenses.",
    explanation: "Categorizing a personal cost as a business expense would misstate the books and the tax return. That is a control violation the system will not perform, even when instructed.",
    compliantAlternative: "I can categorize it to 7990 Non-Deductible / Personal Expense (Review) pending review, flag it for the CPA, and — if part of it is genuinely business use — document the business portion so the CPA can decide on the allowable treatment.",
  },
  {
    kind: "IGNORE_DOCUMENTATION",
    patterns: [
      /\b(ignore|skip|forget|waive|bypass|don'?t\s+(worry|bother)\s+about|no\s+need\s+for|overlook)\b[^.?!]{0,40}\b(missing\s+)?(receipt|receipts|documentation|invoice|support(ing)?\s+doc|backup)\b/i,
      /\b(missing|no)\s+receipt\b[^.?!]{0,40}\b(ignore|skip|doesn'?t\s+matter|just\s+(book|post|categori[sz]e|approve|expense)|anyway|is\s+fine|don'?t\s+(flag|worry|care))/i,
      /\b(approve|book|expense|post|categori[sz]e)\b[^.?!]{0,30}\b(it\s+)?anyway\b[^.?!]{0,30}\breceipt/i,
    ],
    control: "Expense documentation policy: expenses above the documentation threshold require a receipt or equivalent support before they are treated as substantiated.",
    explanation: "Suppressing a missing-receipt flag would remove the evidence trail the CPA and any examiner rely on. The flag stays until the document is provided or the CPA accepts an alternative.",
    compliantAlternative: "I can keep the transaction categorized with the MISSING_RECEIPT flag, request the receipt from the merchant or cardholder, and record a documented explanation for the CPA if the receipt is truly unobtainable.",
  },
  {
    kind: "PAYMENT_WITHOUT_APPROVAL",
    patterns: [
      /\b(pay|wire|send|transfer|remit|ach|settle|release\s+(the\s+)?payment)\b[^.?!]{0,80}\b(without|skip|bypass|no|before|regardless\s+of)\b[^.?!]{0,20}\b(approval|approv(e|ing)|sign[\s-]?off|authori[sz]ation|review|owner)/i,
      /\b(just|go\s+ahead\s+and|immediately|right\s+now|today)\s+(pay|wire|send\s+(the\s+)?money|transfer)\b[^.?!]{0,60}\b(don'?t|no|without|skip)\b[^.?!]{0,20}\b(approval|ask|wait|review)/i,
      /\bwithout\s+(an?\s+)?approval\b[^.?!]{0,60}\b(pay|payment|wire|transfer)/i,
    ],
    control: "Approval matrix: every payment is a RED action that requires an approved request from an authorized human; in Phase One payments are simulation-only and never execute.",
    explanation: "Paying a vendor without approval bypasses the segregation of duties that protects the company's cash. The system cannot execute payments in Phase One at all, and would never do so without an APPROVED request.",
    compliantAlternative: "I can prepare the payment package (bill details, amount, due date, vendor status, cash impact) and route it as an approval request to the owner. Once approved, the payment is executed by a human through the bank, not by me.",
  },
  {
    kind: "ALTER_CLOSED_BOOKS",
    patterns: [
      /\b(change|alter|edit|adjust|modify|fix|restate|rework|massage|tweak|move|shift)\b[^.?!]{0,60}\b(last|prior|previous|closed|locked)\s+(month|quarter|year|period|december|january|february|march|april|may|june|july|august|september|october|november)('s)?\b[^.?!]{0,60}\b(books|numbers|entries|ledger|profit|income|loss|revenue|expenses?|results?|financials)/i,
      /\b(so|to\s+make|so\s+that|make)\b[^.?!]{0,40}\b(profit|income|loss|revenue|expenses?|net|margin|taxes?)\b[^.?!]{0,30}\b(looks?|appears?|seems?|shows?|comes?\s+out)\s+(lower|higher|smaller|bigger|better|worse|less|more)/i,
      /\b(books|ledger|entries|numbers)\b[^.?!]{0,40}\b(look|appear)\s+(lower|higher|better|worse)/i,
      /\b(reopen|unlock)\b[^.?!]{0,40}\b(period|month|quarter|year)\b[^.?!]{0,60}\b(change|move|shift|reduce|increase|lower|raise)\b[^.?!]{0,40}\b(profit|income|revenue|expense|tax)/i,
      /\b(reduce|lower|increase|inflate|deflate|shrink|boost)\b[^.?!]{0,20}\b(last|prior|previous)\s+(month|quarter|year|period|[a-z]+)('s)?\s+(profit|income|revenue|expenses?|taxes?)/i,
    ],
    control: "Period lock policy: locked periods are immutable. Prior-period corrections are made only through dated correcting entries with a documented reason and RED approval — never by rewriting history, and never to steer a result.",
    explanation: "Changing a closed period so that a result looks different is misstatement. The ledger refuses to post into a locked period, and I will not reopen one to change a reported outcome.",
    compliantAlternative: "If there is a genuine error, I can draft a dated correcting entry (reversal plus re-entry) in the current open period with the reason recorded, and route it for approval and CPA review. If the change is about tax outcome, that is a question for the CPA, not a bookkeeping change.",
  },
  {
    kind: "REASONABLE_COMP_DECISION",
    patterns: [
      /\b(mark|deem|declare|confirm|certify|treat|approve|sign\s+off|document|record|state|say|call)\b[^.?!]{0,60}\b(salary|compensation|wage|pay)\b[^.?!]{0,40}\b(as\s+)?reasonable\b/i,
      /\breasonable\s+(compensation|salary|comp)\b[^.?!]{0,60}\b(mark|deem|declare|confirm|certify|approve|set\s+it|just\s+(say|call|treat)|sign)/i,
      /\b(just|simply)\s+(mark|say|call|treat|record)\b[^.?!]{0,40}\b(it|that|this|salary|comp\w*)\s+(as\s+)?reasonable/i,
      /\bsalary\b[^.?!]{0,30}\breasonable\b[^.?!]{0,30}\b(so|to)\b[^.?!]{0,40}\b(cpa|irs|audit|distribution|tax)/i,
    ],
    control: "Reasonable compensation for an S-corporation shareholder-employee is a professional judgment made with the CPA on documented facts — never a label applied by the system.",
    explanation: "I can compute what a proposed salary means for payroll taxes and cash, but I cannot declare a salary 'reasonable'. That determination depends on facts and standards that require CPA judgment and documentation.",
    compliantAlternative: "I can prepare the reasonable-compensation workpaper: the proposed figure as an ASSUMPTION, the payroll cost calculations, the facts (role, hours, revenue, distributions) and the open professional-judgment questions, and add it to the CPA review queue.",
  },
  {
    kind: "CONCEAL_FROM_PROFESSIONAL",
    patterns: [
      /\b(don'?t|do\s+not|never|no\s+need\s+to|without)\s+(tell|inform|mention|show|disclose|report|flag|share)\b[^.?!]{0,40}\b(to\s+)?(the\s+)?(cpa|accountant|auditor|attorney|lawyer|tax\s+(pro|professional|advisor|preparer)|irs|ftb|edd)\b/i,
      /\b(keep|hide|leave)\s+(this|that|it)\s+(from|out\s+of)\b[^.?!]{0,30}\b(the\s+)?(cpa|accountant|auditor|attorney|package|return)/i,
      /\b(between\s+us|off\s+the\s+record|our\s+secret|just\s+between)\b/i,
      /\b(cpa|accountant|auditor)\b[^.?!]{0,30}\b(doesn'?t|does\s+not|shouldn'?t|need\s+not)\s+(need\s+to\s+)?(know|see|hear)/i,
    ],
    control: "Professional transparency: the CPA, auditor and attorney receive complete and accurate information. Nothing material is withheld from the CPA package.",
    explanation: "Withholding information from the CPA or an authority would undermine the professionals who sign off on the company's filings and can turn an honest question into a compliance problem.",
    compliantAlternative: "I can document the item accurately, include it in the CPA package with a clear note of the question or concern, and let the CPA advise on the correct treatment.",
  },
  {
    kind: "HIDE_OR_DELETE_RECORDS",
    patterns: [
      /\b(hide|conceal|bury|obscure|disguise|mask|scrub|erase|wipe|purge)\b[^.?!]{0,50}\b(transaction|transactions|entry|entries|payment|payments|income|revenue|expense|expenses|records?|distribution|invoice|bill|cash|deposit|withdrawal|it|this|that)\b/i,
      /\b(delete|remove|drop|purge|erase|destroy|get\s+rid\s+of|clear|wipe|truncate|reset|clean\s+out)\b[^.?!]{0,40}\b(the\s+)?(posted\s+)?(journal\s+)?(entry|entries|record|records|transaction|transactions|audit\s+(log|trail|events?|history)|history|invoice|bill|receipt|document|documents|evidence)\b/i,
      /\b(off\s+the\s+books|under\s+the\s+table|unrecorded)\b/i,
    ],
    control: "Immutable records: posted entries are never edited or removed (only reversed), and the audit log is hash-chained and append-only.",
    explanation: "Hiding or removing financial records destroys the evidence trail. Posted entries can only be corrected by a dated reversal; audit events are immutable and cannot be removed, cleared or rewritten.",
    compliantAlternative: "If a record is wrong, I can draft a reversal or correcting entry with the reason recorded. If a document is sensitive, access can be restricted by role without deleting it.",
  },
  {
    kind: "BACKDATE",
    patterns: [
      /\bback[\s-]?dat(e|ed|ing)\b/i,
      /\b(date|dated)\s+(it|this|the\s+(entry|invoice|contract|agreement|check|payment|document))\b[^.?!]{0,30}\b(last|prior|previous|earlier|december|january|year|month)\b/i,
      /\b(make|pretend|show)\b[^.?!]{0,30}\b(it|this)\s+(look|appear|as\s+if)\b[^.?!]{0,30}\b(happened|occurred|was\s+(paid|signed|dated))\b[^.?!]{0,30}\b(earlier|last|before|in\s+20\d{2})/i,
    ],
    control: "Dates on entries and documents reflect when events actually occurred. Backdating is a misstatement, not a correction.",
    explanation: "Backdating an entry or document creates a false record. Corrections are dated when they are made and reference the original.",
    compliantAlternative: "I can record the transaction with its true date and, if it belongs economically to an earlier period, draft a properly dated correcting or adjusting entry with a note for the CPA.",
  },
  {
    kind: "FILE_OR_SIGN",
    patterns: [
      /\b(file|e-?file|submit|transmit|send\s+in|lodge)\b[^.?!]{0,30}\b(the\s+)?(tax\s+)?(return|returns|1120-?s|100s|941|940|de\s?9|1099s?|w-?2s?|extension|form\s+\d+)\b/i,
      /\b(sign|e-?sign|execute)\b[^.?!]{0,30}\b(the\s+)?(return|tax\s+return|contract|agreement|lease|loan|documents?|form|filing|8879|2553)\b/i,
      /\bfile\s+(my|our|the)\s+taxes\b/i,
    ],
    control: "Tax filings and signatures are executed only by authorized humans and professionals. In Phase One the system prepares packages and workpapers; it never files or signs.",
    explanation: "Filing a return or signing a document is a legally binding act that the system is prohibited from performing.",
    compliantAlternative: "I can assemble the CPA package, the document checklist and the workpapers so the CPA can prepare and file, and the owner can sign.",
  },
  {
    kind: "MOVE_MONEY",
    patterns: [
      /\b(move|transfer|wire|send|shift|sweep)\b[^.?!]{0,20}\b(the\s+)?(money|cash|funds|\$?\d[\d,]*(\.\d+)?k?)\b[^.?!]{0,40}\b(to|into|from|out\s+of)\b[^.?!]{0,40}\b(my|personal|owner|shareholder|savings|checking|account|bank|venmo|paypal|zelle)\b/i,
      /\b(take|pull|draw|withdraw)\b[^.?!]{0,20}\b(money|cash|funds|\$?\d[\d,]*)\b[^.?!]{0,30}\b(out\s+of|from)\s+(the\s+)?(business|company|account)\b/i,
      /\b(pay|send)\s+(me|myself|the\s+owner)\b[^.?!]{0,40}\b(\$?\d[\d,]*|distribution|bonus|draw)\b/i,
    ],
    control: "No money moves in Phase One. Transfers, distributions and withdrawals are RED actions that require approval and are executed by humans through the bank.",
    explanation: "Moving money is outside what the system may do. Distributions in particular affect shareholder basis and require CPA input.",
    compliantAlternative: "I can model the cash impact, prepare a distribution or transfer proposal with the reserve-policy check and the basis question for the CPA, and route it for owner approval.",
  },
  {
    kind: "MISSTATE_FIGURES",
    patterns: [
      /\b(numbers|results|financials|books|figures|statements|margins?|revenue|profit)\b[^.?!]{0,40}\b(look|appear|seem)\s+(healthier|better|stronger|cleaner|nicer|prettier|more\s+(attractive|impressive))\b/i,
      /\bmake\b[^.?!]{0,30}\b(numbers|results|financials|books|figures|month|quarter|year)\b[^.?!]{0,30}\blook\b/i,
      /\b(move|shift|pull|push)\b[^.?!]{0,40}\b(revenue|income|sales|expenses?|costs?)\b[^.?!]{0,40}\b(into|to|from|forward|back)\b[^.?!]{0,30}\b(august|september|october|november|december|january|february|march|april|may|june|july|last\s+month|prior\s+month|next\s+month|this\s+month|q[1-4]|the\s+(prior|next|previous)\s+(month|quarter|year))\b/i,
      /\b(drop|remove|omit|leave\s+out|kill|skip|delete)\b[^.?!]{0,30}\b(the\s+)?accru(ed|al)\b/i,
      /\bround\b[^.?!]{0,40}\b(numbers?|revenue|figures|balances?|results)\b[^.?!]{0,30}\b(up|down)\b/i,
      /\b(inflate|pad|fudge|massage|smooth|juice|goose|overstate|understate)\b[^.?!]{0,30}\b(the\s+)?(numbers?|revenue|figures|results|earnings|profit|margins?|balances?)\b/i,
    ],
    control: "Financial reports present figures exactly as recorded in the ledger. Revenue and expenses stay in the period they belong to; accruals are not dropped, and numbers are never rounded or reshaped to look healthier for an investor, lender or anyone else.",
    explanation: "Reshaping the numbers so a period looks healthier is misstatement. I present the actual figures as recorded, with their supporting calculations, and cannot change them to fit a narrative.",
    compliantAlternative: "I can produce the actual statements as recorded with a plain-language explanation of what drove the results, a forward-looking forecast that shows the expected improvement, and a note on any genuine cut-off or accrual correction the CPA agrees is warranted.",
  },
  {
    kind: "FALSE_ASSURANCE",
    patterns: [
      /\b(confirm|certify|state|say|write|attest|declare|sign\s+off|represent)\b[^.?!]{0,60}\b(audited|reviewed\s+by\s+(an?\s+)?(auditor|cpa)|gaap[\s-]?compliant|accurate\s+and\s+complete|fully\s+accurate|free\s+of\s+(errors?|misstatement))\b/i,
      /\b(these|the|our)\s+(financials|statements|books|numbers)\s+(are|have\s+been)\s+audited\b/i,
    ],
    control: "Assurance is given only by an independent auditor or the CPA. The system never represents unaudited or synthetic figures as audited, reviewed or certified.",
    explanation: "I cannot certify these financials: they are unaudited, and in Phase One they are synthetic lab data with no independent audit. A written assurance from me would be false and could mislead a bank or investor.",
    compliantAlternative: "I can label the statements as internally prepared and unaudited, run the internal integrity checks, and prepare the package the CPA or an auditor would need to issue a review or audit report.",
  },
  {
    kind: "SELF_AUTONOMY",
    patterns: [
      /\b(raise|increase|set|change|bump|upgrade|promote|grant)\b[^.?!]{0,40}\b(your\s+(own\s+)?)?(autonomy|capability|permission|access|trust)\s+level\b/i,
      /\b(promote|upgrade)\s+yourself\b/i,
      /\b(give|grant)\s+yourself\b[^.?!]{0,30}\b(permission|access|authority|autonomy)\b/i,
      /\bso\s+you\s+can\s+(pay|move|file|sign|approve)\b[^.?!]{0,30}\bwithout\s+(asking|approval|me)\b/i,
    ],
    control: "Capability (autonomy) levels are set only by the owner through the capability matrix after evaluation evidence; an agent can never change its own level, and payments, payroll, filings and signatures stay human-executed in Phase One.",
    explanation: "I cannot raise my own autonomy level. Levels are decided by the owner (a human) from eval results, and payment execution is capped at analysis-only in Phase One regardless of level.",
    compliantAlternative: "I can show the current capability matrix, the eval pass rates behind each level, and prepare the promotion request for the owner to decide.",
  },
  {
    kind: "SELF_APPROVAL",
    patterns: [
      /\bapprove\s+(it|this|that|the\s+\w+)\s+yourself\b/i,
      /\byou\s+(can|may|should)\s+approve\b/i,
      /\bself[\s-]?approv/i,
      /\bapprove\s+(it|this|that)\s+(for\s+me|on\s+my\s+behalf|yourself)\b/i,
      /\bskip\s+(the\s+)?approval\b/i,
    ],
    control: "Segregation of duties: an agent can propose but never approve; approvals come from an authorized human who is not the requester.",
    explanation: "I cannot approve my own proposals — an approval by the same party that requested the action is no control at all. The request stays pending until an authorized person decides it.",
    compliantAlternative: "I can prepare the draft and queue the approval request with the full rationale so the owner or finance operator can approve it in one step.",
  },
];

/** Task kinds that legitimately touch a guarded topic and therefore skip weaker patterns. */
const LEGITIMATE_CONTEXT: Partial<Record<ControlViolationKind, RegExp>> = {
  MOVE_MONEY: /\b(forecast|model|what\s+if|should\s+we|can\s+we\s+afford|impact|scenario|plan|project(ion)?|categori[sz]e|classify|record|book|match|reconcile|explain|why|check|risk|flag|review)\b/i,
  FILE_OR_SIGN: /\b(when|deadline|due|calendar|checklist|what\s+do\s+(i|we)\s+need|prepare|package)\b/i,
  PERSONAL_AS_BUSINESS: /\b(can\s+i|could\s+i|should\s+i|may\s+i|is\s+it\s+(ok|okay|allowed|deductible|legal)|am\s+i\s+allowed|what\s+if|how\s+(do|should)\s+i\s+(treat|handle)|is\s+this)\b|\?\s*$/i,
};

/** Read-only analysis tasks: describing a payment or transfer to be assessed is not a request to perform it. */
const ANALYSIS_TASKS = new Set(["controls.risk_assess", "controls.personal_business_check", "controls.audit_explain", "accounting.classify_transaction", "accounting.detect_duplicates", "accounting.match_transfers", "documents.classify"]);
const ANALYSIS_SKIPPED_KINDS = new Set<ControlViolationKind>(["MOVE_MONEY", "PAYMENT_WITHOUT_APPROVAL", "FILE_OR_SIGN", "HIDE_OR_DELETE_RECORDS"]);

/** Explicit RED task kinds whose tool returns the prepared package and a BLOCKED action; the FILE_OR_SIGN pattern is left to that tool. */
const RED_TOOL_TASKS = new Set(["tax.file_return", "ap.pay_bill", "payroll.change"]);

export function detectControlViolation(message: string, taskKind?: string, params?: Record<string, unknown>): ControlViolation | null {
  const redTool = taskKind !== undefined && RED_TOOL_TASKS.has(taskKind);
  const text = redTool ? (message ?? "") : [message ?? "", typeof params?.description === "string" ? params.description : "", typeof params?.notes === "string" ? params.notes : "", typeof params?.question === "string" ? params.question : ""].join("\n");
  if (!text.trim()) return null;
  const analysis = taskKind !== undefined && ANALYSIS_TASKS.has(taskKind);
  for (const g of GUARD_PATTERNS) {
    if (redTool && g.kind === "FILE_OR_SIGN") continue;
    if (analysis && ANALYSIS_SKIPPED_KINDS.has(g.kind)) continue;
    const legit = LEGITIMATE_CONTEXT[g.kind];
    for (const p of g.patterns) {
      const m = p.exec(text);
      if (!m) continue;
      // A question phrased as analysis ("what would it cost to move money…") is allowed for MOVE_MONEY / FILE_OR_SIGN
      if (legit && legit.test(text) && !/\b(just|now|immediately|go\s+ahead|do\s+it|without)\b/i.test(text)) continue;
      return { kind: g.kind, control: g.control, explanation: g.explanation, compliantAlternative: g.compliantAlternative, matched: m[0].slice(0, 120) };
    }
  }
  return null;
}

export function escalationForViolation(v: ControlViolation): Escalation {
  return {
    type: "REFUSED_CONTROL_VIOLATION",
    message: `${v.control} ${v.explanation}`,
    requiredRole: v.kind === "REASONABLE_COMP_DECISION" || v.kind === "CONCEAL_FROM_PROFESSIONAL" ? "CPA" : "OWNER",
    missingItems: [],
  };
}
