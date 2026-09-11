/** Tax operations agent: calendar, rule-based calculations, guarded questions, workpapers, CPA package. Never files. */
import type { RouteRule } from "../intent";
import { calculateWithRuleTool, cpaPackageTool, documentChecklistTool, fileReturnTool, shareholderSummaryTool, taxCalendarTool, taxQuestionTool, taxWorkpaperTool } from "../tools/tax-tools";
import { Specialist } from "./shared";

const TAX_WORDS = /\b(tax(es|able)?|1120-?s|100s|941|940|1099s?|k-?1|irs|ftb|edd|franchise|deduct(ible|ion)?|withholding|estimated (tax|payment)s?|s[\s-]?corp\w*|reasonable\s+(comp\w*|salary|pay|wages?)|write[\s-]?off|cpa)\b/i;

const rules: RouteRule[] = [
  { kind: "tax.file_return", weight: 3.6, any: [/\b(file|e-?file|submit|transmit|sign|lodge)\b[^.?!]{0,30}\b(tax )?(return|returns|taxes|1120-?s|100s|941|940|1099s?|extension|form \d+)\b/i, /\bfile (my|our|the) taxes\b/i], none: [/\b(when|deadline|due|calendar|checklist|what do (i|we) need)\b/i], params: (m) => ({ description: m }) },
  { kind: "tax.cpa_package", weight: 3.4, any: [/\bcpa package\b/i, /\bpackage for (the|my|our) (cpa|accountant)\b/i, /\byear[- ]end package\b/i, /\bprepare .* for the cpa\b/i, /\bsend .* to the cpa\b/i], params: (_m, e, asOf) => ({ from: e.dates[0] ?? `${e.years[0] ?? Number(asOf.slice(0, 4))}-01-01`, to: e.dates[1] ?? (e.years[0] ? `${e.years[0]}-12-31` : asOf) }) },
  { kind: "tax.shareholder_summary", weight: 3.4, any: [/\b(wages?|salary|officer comp\w*)\b[^.?!]{0,20}\b(vs\.?|versus|and|compared to|against)\b[^.?!]{0,10}\bdistributions?\b/i, /\bdistributions?\b[^.?!]{0,20}\b(vs\.?|versus|and|compared to)\b[^.?!]{0,10}\b(wages?|salary|officer comp\w*)\b/i, /\bshareholder summary\b/i, /\bk-?1 summary\b/i, /\bsalary[- ]distribution (split|mix|ratio)\b/i], params: (_m, e, asOf) => ({ taxYear: e.years[0] ?? Number(asOf.slice(0, 4)) }) },
  { kind: "tax.document_checklist", weight: 3.2, any: [/\btax (document|doc)s? (checklist|list|status)\b/i, /\bdocument checklist\b/i, /\bwhat (does|will) the cpa need\b/i, /\bwhat (documents|docs) (do (we|i) need|are needed) for (the )?(tax|return|cpa)\b/i, /\btax (prep|preparation) checklist\b/i], params: (_m, e, asOf) => ({ taxYear: e.years[0] ?? Number(asOf.slice(0, 4)) }) },
  { kind: "tax.workpaper", weight: 3.2, any: [/\bworkpaper/i, /\btax (work ?papers?|schedule|summary for the year)\b/i], params: (m, e, asOf) => ({ taxYear: e.years[0] ?? Number(asOf.slice(0, 4)), topic: /\b(franchise|payroll|meals|depreciation|owner)\b/i.exec(m)?.[1] }) },
  { kind: "tax.calendar", weight: 3, any: [/\btax (calendar|deadlines?|due dates?|filing dates?|schedule)\b/i, /\bwhen (is|are|do) (our |the |my )?(next )?(1120-?s|100s|941|940|1099s?|de ?9|statement of information|tax(es)?|return|estimated (tax|payment)s?|franchise tax)\b[^.?!]{0,30}\b(due|deadline|owed|filed|need)/i, /\b(filing|tax) deadline/i, /\bupcoming (tax )?(filings|obligations|deadlines)\b/i, /\bwhat taxes are (due|coming)\b/i, /\bdue dates? for\b[^.?!]{0,30}\b(tax|return|941|1120)/i], params: (_m, e, _asOf) => ({ taxYear: e.years[0], asOf: e.dates[0] }) },
  { kind: "tax.question", weight: 2.6, all: [TAX_WORDS], none: [/\bpayroll (dates?|calendar|liabilit)/i], params: (m, e, _asOf) => ({ question: m, taxYear: e.years[0] }) },
];

export function createTaxAgent(): Specialist {
  return new Specialist({
    name: "tax",
    description: "Tax operations: obligations calendar, rule-based calculations with approved TaxRules, guarded tax questions, workpapers, document checklist and the CPA package. Never files, never decides tax positions.",
    keywords: [TAX_WORDS, /\bcpa\b/i, /\bdeduct/i, /\bfiling/i, /\breturn\b/i, /\birs\b/i, /\bfranchise\b/i, /\breasonable\b/i, /\bdistribution/i],
    rules,
    tools: [
      [taxCalendarTool, "tax.calendar"],
      [calculateWithRuleTool, "tax.calculate_with_rule"],
      [taxQuestionTool, "tax.question"],
      [taxWorkpaperTool, "tax.workpaper"],
      [documentChecklistTool, "tax.document_checklist"],
      [cpaPackageTool, "tax.cpa_package"],
      [fileReturnTool, "tax.file_return"],
      [shareholderSummaryTool, "tax.shareholder_summary"],
    ],
  });
}
