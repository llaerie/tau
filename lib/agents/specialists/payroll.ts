/** Payroll agent: monitoring and reconciliation; never runs or changes payroll, never classifies workers. */
import type { RouteRule } from "../intent";
import { classificationFlagTool, employerCostTool, grossToNetTool, internationalReviewTool, ownerCompensationTool, payrollCalendarTool, payrollChangeTool, payrollLiabilitiesTool, reconcileRunTool } from "../tools/payroll-tools";
import { Specialist } from "./shared";

const rules: RouteRule[] = [
  { kind: "payroll.change", weight: 3.4, any: [/\b(run|process|execute|submit|approve)\b[^.?!]{0,15}\bpayroll\b/i, /\b(change|update|raise|increase|lower|reduce|set|adjust|bump|cut)\b[^.?!]{0,40}\b(salary|pay rate|wages?|compensation|payroll)\b/i, /\badd\b[^.?!]{0,30}\bto payroll\b/i, /\bgive\b[^.?!]{0,30}\b(a )?(raise|bonus)\b/i, /\bpay (a |the )?bonus\b/i, /\bput\b[^.?!]{0,30}\bon payroll\b/i], none: [/\breasonable\b/i, /\bmodel\b/i, /\bwhat (would|if)\b/i, /\bhow much would\b/i], params: (m, e, _asOf) => ({ description: m, workerId: e.ids.find((i) => i.startsWith("w_") || i.startsWith("worker_") || i.startsWith("wrk_")), amount: e.amounts[0] }) },
  { kind: "payroll.international_review", weight: 3.2, any: [/\binternational (worker|contractor|employee|team)/i, /\b(china|chinese|overseas|abroad|cross[- ]border|foreign)\b[^.?!]{0,30}\b(worker|contractor|employee|team|hire|review|checklist|status)\b/i, /\b(worker|contractor|employee)s?\b[^.?!]{0,20}\b(in|from) (china|abroad|overseas)\b/i], none: [/\bclassif/i, /\bcontractor or (an? )?employee\b/i, /\bemployee or (an? )?contractor\b/i, /\b1099 or w-?2\b/i], params: (_m, e, _asOf) => ({ workerId: e.ids.find((i) => i.startsWith("w_") || i.startsWith("worker_") || i.startsWith("wrk_")) }) },
  { kind: "payroll.classification_flag", weight: 3.2, any: [/\bcontractor or (an )?employee\b/i, /\bemployee or (a )?contractor\b/i, /\b1099 or w-?2\b/i, /\bw-?2 or 1099\b/i, /\b(should|can) (we|i) (treat|classify|pay)\b[^.?!]{0,30}\b(as a )?(contractor|employee|1099)\b/i, /\bclassif(y|ication)\b[^.?!]{0,40}\b(worker|contractor|employee)\b/i, /\b(worker|contractor|employee)\b[^.?!]{0,40}\bclassif/i, /\bmisclassif/i], params: (m, e, _asOf) => ({ workerId: e.ids.find((i) => i.startsWith("w_") || i.startsWith("worker_") || i.startsWith("wrk_")), description: m, country: /\b(china|cn)\b/i.test(m) ? "CN" : /\b(canada)\b/i.test(m) ? "CA" : /\b(india)\b/i.test(m) ? "IN" : undefined }) },
  { kind: "payroll.owner_compensation", weight: 3, any: [/\bowner('s)? (salary|comp\w*|pay|wages?)\b/i, /\bmy (own )?(salary|comp\w*|wages?)\b/i, /\bpay myself\b/i, /\bofficer comp\w*/i, /\bsalary (vs\.?|versus|and|or) distributions?\b/i], none: [/\breasonable\b/i, /\btax\b/i, /\bdistributions? (vs|versus|and)\b/i], params: (m, e, _asOf) => ({ proposedMonthlyGross: /\b(per|a|\/)\s?month\b/i.test(m) ? e.amounts[0] : e.amounts[0] && /\b(per|a|\/)\s?(year|yr|annum)\b/i.test(m) ? (Number(e.amounts[0]) / 12).toFixed(4) : e.amounts[0] }) },
  { kind: "payroll.reconcile_run", weight: 3, all: [/\bpayroll\b/i], any: [/\breconcil/i, /\btie (out|to the bank)\b/i, /\bmatch(es)? (the )?bank\b/i], params: (_m, e, _asOf) => ({ payrollRunId: e.ids.find((i) => i.startsWith("run_") || i.startsWith("pr_") || i.startsWith("payroll_")), payDate: e.dates[0] }) },
  { kind: "payroll.employer_cost", weight: 2.8, any: [/\bemployer (cost|tax(es)?|side|burden)\b/i, /\bpayroll tax(es)? on\b/i, /\bcost to employ\b/i, /\btotal cost of (a |the )?(\$?[\d,]+k?\s?)?(salary|employee)\b/i, /\bwhat (will|does|would) .* cost (us|the company) (in )?(payroll )?tax/i, /\b(fica|futa|suta|sui)\b[^.?!]{0,30}\bon\b/i], none: [/\bnet pay\b/i, /\bhire\b/i, /\bfully[- ]loaded\b/i, /\bheadcount\b/i], params: (m, e, _asOf) => ({ gross: e.amounts[0], period: /\b(per|a|\/)\s?(year|yr|annum|annual)\b/i.test(m) || /\bannual\b/i.test(m) ? "ANNUAL" : "MONTHLY" }) },
  { kind: "payroll.gross_to_net", weight: 2.8, any: [/\bgross[- ]to[- ]net\b/i, /\bnet pay\b/i, /\btake[- ]home\b/i, /\bafter (withholding|taxes)\b/i], params: (_m, e, _asOf) => ({ gross: e.amounts[0] }) },
  { kind: "payroll.liabilities", weight: 2.6, any: [/\bpayroll (tax )?liabilit/i, /\bpayroll tax(es)? (owed|payable|due|outstanding|deposits?)\b/i, /\bwithholdings? (owed|payable|due)\b/i, /\bowe\b[^.?!]{0,20}\bpayroll tax/i, /\btax deposits? (due|owed)\b/i, /\baccrued payroll\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0] }) },
  { kind: "payroll.calendar", weight: 2.4, any: [/\bnext payroll\b/i, /\bpayroll (dates?|calendar|schedule|cadence|timing)\b/i, /\bwhen (is|are|does) (the )?(next )?payroll\b/i, /\bupcoming payroll\b/i, /\bpay ?days?\b/i, /\bhow much is payroll\b/i, /\bpayroll (next|this) (week|month)\b/i], params: (_m, e, _asOf) => ({ asOf: e.dates[0], months: e.durations.find((d) => d.unit === "MONTH")?.value }) },
];

export function createPayrollAgent(): Specialist {
  return new Specialist({
    name: "payroll",
    description: "Payroll: calendar, run reconciliation, employer cost and gross-to-net with supplied rates, liabilities, classification flags and international worker review; never runs or changes payroll.",
    keywords: [/\bpayroll\b/i, /\bsalar/i, /\bwages?\b/i, /\bwithhold/i, /\bemployee/i, /\bcontractor/i, /\bworker/i, /\bnet pay\b/i, /\bfica\b/i, /\bemployer\b/i, /\bhire\b/i, /\bcompensation\b/i],
    rules,
    tools: [
      [payrollCalendarTool, "payroll.calendar"],
      [reconcileRunTool, "payroll.reconcile_run"],
      [employerCostTool, "payroll.employer_cost"],
      [grossToNetTool, "payroll.gross_to_net"],
      [payrollLiabilitiesTool, "payroll.liabilities"],
      [classificationFlagTool, "payroll.classification_flag"],
      [internationalReviewTool, "payroll.international_review"],
      [payrollChangeTool, "payroll.change"],
      [ownerCompensationTool, "payroll.owner_compensation"],
    ],
  });
}
