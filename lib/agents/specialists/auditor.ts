/** Auditor agent: independent verification on an isolated ledger clone (see lib/agents/isolation.ts). */
import type { RouteRule } from "../intent";
import { auditExplainTool, integrityCheckTool, personalBusinessCheckTool, riskAssessTool, verifyReportTool } from "../tools/controls-tools";
import { Specialist, previousMonth } from "./shared";
import { monthRange } from "../intent";

const rules: RouteRule[] = [
  { kind: "controls.audit_explain", weight: 3.6, any: [/\bwhy did (the cfo|tau|you|the system|the agent|the ai)\b/i, /\bexplain (the |that |this )?(decision|action|categori[sz]ation|approval|entry) /i, /\baudit trail (for|of)\b/i, /\bshow me why\b/i, /\bwho (approved|proposed|posted)\b/i, /\bhow did (this|that) (get|end up)\b/i], params: (_m, e, _asOf) => ({ targetId: e.ids[0] ?? "" }) },
  { kind: "controls.personal_business_check", weight: 3.4, any: [/\bpersonal or business\b/i, /\bbusiness or personal\b/i, /\bis (this|that|it) (a )?personal\b/i, /\bmixed[- ]use\b/i, /\bpersonal expense\b/i, /\blooks? personal\b/i, /\bpersonal (charge|spend|purchase)\b/i], params: (m, e, _asOf) => ({ transactionId: e.ids.find((i) => i.startsWith("tx_")), description: m, amount: e.amounts[0], notes: m }) },
  { kind: "controls.risk_assess", weight: 3.4, any: [/\brisk (level|assess\w*|rating|classification)\b/i, /\bhow risky\b/i, /\bis (this|that|it) (green|yellow|red)\b/i, /\bwhat approval (does|would|is)\b/i, /\bwho (needs|has) to approve\b/i, /\bassess the risk\b/i, /\bwould (this|that|it) (need|require) approval\b/i], params: (m, e, _asOf) => ({ kind: /\bpay(ment)?\b/i.test(m) ? "EXECUTE_PAYMENT" : /\bdistribution\b/i.test(m) ? "PROPOSE_DISTRIBUTION" : /\bvendor\b/i.test(m) ? "CREATE_VENDOR" : /\bcategori/i.test(m) ? "CATEGORIZE_TRANSACTION" : /\bpayroll\b/i.test(m) ? "CHANGE_PAYROLL" : /\block\b/i.test(m) ? "LOCK_PERIOD" : "CREATE_JOURNAL_ENTRY", amount: e.amounts[0], description: m }) },
  { kind: "controls.verify_report", weight: 3.2, any: [/\bverify\b/i, /\bdouble[- ]check\b/i, /\bindependent(ly)? (check|verif|recompute)/i, /\bre-?compute\b/i, /\bconfirm (the |that the )?(report|statements?|numbers) (reconcile|tie|are right|are correct)\b/i, /\baudit (the )?(report|statements?|financials)\b/i], params: (m, e, asOf) => { const r = e.months[0] ? monthRange(e.months[0]) : e.dates.length >= 2 ? { from: e.dates[0], to: e.dates[1] } : monthRange(previousMonth(asOf)); return { ...r, focus: m }; } },
  { kind: "accounting.integrity_check", weight: 3, any: [/\bintegrity\b/i, /\binvariants?\b/i, /\bdoes the ledger balance\b/i, /\bsanity[- ]check\b/i, /\baudit the (ledger|books)\b/i, /\bare the books (clean|balanced|consistent)\b/i, /\bledger (health|checks?)\b/i, /\bcontrol checks?\b/i], params: (_m, e, asOf) => ({ asOf: e.dates[0] ?? asOf }) },
];

export function createAuditorAgent(): Specialist {
  return new Specialist({
    name: "auditor",
    description: "Auditor: ledger integrity, independent report verification, risk assessment, personal/business checks and audit-trail explanations — always on an isolated copy of the books.",
    keywords: [/\baudit/i, /\bverif/i, /\bintegrity\b/i, /\brisk\b/i, /\bcontrol/i, /\bwhy did\b/i, /\bpersonal\b/i, /\bcheck\b/i, /\bexplain\b/i, /\bapprov/i],
    rules,
    tools: [
      [integrityCheckTool, "accounting.integrity_check"],
      [riskAssessTool, "controls.risk_assess"],
      [personalBusinessCheckTool, "controls.personal_business_check"],
      [auditExplainTool, "controls.audit_explain"],
      [verifyReportTool, "controls.verify_report"],
    ],
  });
}
