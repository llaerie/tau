import { describe, expect, it } from "vitest";
import { createAgents } from "@/lib/agents/registry";
import { OWNER } from "./fixture";

const SAMPLES: [string, string, string][] = [
  ["What's our cash position today?", "treasury", "cash.position"],
  ["Run a 13-week cash flow forecast", "treasury", "cash.thirteen_week"],
  ["How many months of runway do we have?", "treasury", "cash.runway"],
  ["Do we have enough cash in reserve?", "treasury", "cash.reserve_coverage"],
  ["Show me the income statement for August 2026", "controller", "accounting.financial_statements"],
  ["Draft a journal entry to accrue $2,000 of legal fees at month end", "controller", "accounting.accrual"],
  ["Reconcile the checking account as of 2026-08-31", "controller", "accounting.bank_reconciliation"],
  ["Categorize this transaction: BISTRO LUNE $85.50 on 2026-08-08 on the card, no receipt", "bookkeeping", "accounting.classify_transaction"],
  ["Are there any duplicate charges this month?", "bookkeeping", "accounting.detect_duplicates"],
  ["Show the AR aging", "ar", "ar.aging"],
  ["Which bills are due next week?", "ap", "ap.aging"],
  ["Record a bill from Law LLP for $1,200 dated 2026-09-01", "ap", "ap.bill_intake"],
  ["Pay the Brightwork bill now", "ap", "ap.pay_bill"],
  ["When is the next payroll and how much?", "payroll", "payroll.calendar"],
  ["What does a $120k hire cost fully loaded?", "fpa", "fpa.headcount_plan"],
  ["Budget vs actual for August 2026", "fpa", "fpa.budget_variance"],
  ["What's the NPV of -10000, 4000, 4000, 4000 at 10%?", "strategy", "strategy.npv"],
  ["What's the break-even if fixed costs are $50,000, price $200, variable cost $120", "strategy", "strategy.break_even"],
  ["When is our 1120-S due?", "tax", "tax.calendar"],
  ["Is my $3,000/month salary reasonable compensation?", "tax", "tax.question"],
  ["Which receipts are missing?", "documents", "documents.missing"],
  ["Verify the August 2026 financial statements reconcile", "auditor", "controls.verify_report"],
  ["Why did the CFO categorize tx_github_aug as software?", "auditor", "controls.audit_explain"],
  ["Is the Li Wei developer in China a contractor or an employee?", "payroll", "payroll.classification_flag"],
];

describe("orchestrator routing", () => {
  const { orchestrator } = createAgents();

  it.each(SAMPLES)("routes %s → %s / %s", (message, agent, kind) => {
    const pick = orchestrator.pickAgent({ message, actor: OWNER }, "2026-09-09");
    expect(pick?.agent.name).toBe(agent);
    const routed = (pick!.agent as unknown as { route: (m: string, asOf: string) => { kind: string } | null }).route(message, "2026-09-09");
    expect(routed?.kind).toBe(kind);
  });

  it("routes CFO-level phrasings to itself", () => {
    for (const m of ["How are we doing financially?", "Give me the weekly brief", "What needs my attention today?", "What is still unknown in the finance setup?"]) {
      expect(orchestrator.pickAgent({ message: m, actor: OWNER }, "2026-09-09")?.agent.name).toBe("cfo_orchestrator");
    }
  });

  it("honours targetAgent and task ownership", () => {
    expect(orchestrator.pickAgent({ message: "anything", actor: OWNER, targetAgent: "tax" })?.agent.name).toBe("tax");
    expect(orchestrator.pickAgent({ message: "anything", actor: OWNER, task: { kind: "cash.runway" } })?.agent.name).toBe("treasury");
    expect(orchestrator.pickAgent({ message: "anything", actor: OWNER, task: { kind: "cfo.health" } })?.agent.name).toBe("cfo_orchestrator");
    expect(orchestrator.pickAgent({ message: "anything", actor: OWNER, task: { kind: "nope.nothing" } })).toBeNull();
  });
});
