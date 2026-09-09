# Tau AI CFO — Architecture

Tau is an **AI CFO operating system**, not a chatbot. The language model reasons, explains,
investigates and delegates; it is never the calculator, never the ledger, and never the
authority on tax law. Every number the CFO reports is produced by deterministic code and
carries its formula, inputs, sources and assumptions. Every meaningful action is risk-classified,
routed through an approval engine, and written to an immutable, hash-chained audit log.

This document describes Phase One: the **Training Lab**, which runs entirely on a synthetic
company. No live bank, payroll, accounting or tax integrations exist yet.

## 1. Layered design

```
┌──────────────────────────────────────────────────────────────────────────┐
│  L. Dashboard / API  (Next.js app router, RBAC, session)                  │
├──────────────────────────────────────────────────────────────────────────┤
│  A. CFO Orchestrator ──► B. Specialist agents (11)                        │
│     intent routing, delegation, conflict reconciliation, briefings        │
│     ┌──────────── control guard ─────────────┐                            │
│     │ refuses instructions that violate      │                            │
│     │ controls before any tool runs          │                            │
│     └────────────────────────────────────────┘                            │
├──────────────────────────────────────────────────────────────────────────┤
│  Tools (zod-validated, risk-labelled) wrap the deterministic engines:     │
│  C. Finance calculation engine   D. General ledger / accounting engine    │
│  Forecasting (budget, rolling forecast, 13-week cash, scenarios)          │
├──────────────────────────────────────────────────────────────────────────┤
│  J. Risk engine ─► Approval engine ─► Action executor   K. Audit log      │
│     GREEN / YELLOW / RED, materiality, role routing, Phase One blocks     │
├──────────────────────────────────────────────────────────────────────────┤
│  F/G/H. Knowledge: Layer A authoritative sources (pending retrieval),     │
│         Layer B professional guidance → versioned policies,               │
│         Layer C company finance bible (30 sections, explicit unknowns),   │
│         tax rule store / calendar / workpapers / CPA queue, education     │
│  Hybrid retrieval (BM25 + optional embeddings) with provenance            │
├──────────────────────────────────────────────────────────────────────────┤
│  I. CFO Academy: competency map (12 domains), 500+ evaluation cases,      │
│     scorers, thresholds, per-capability autonomy levels, readiness report │
├──────────────────────────────────────────────────────────────────────────┤
│  E. Data: CompanyDataset (typed), MemoryStore (lab) / PrismaStore (Postgres│
│     NUMERIC(19,4) money, row-level security, insert-only audit table)     │
└──────────────────────────────────────────────────────────────────────────┘
```

## 2. Key modules

| Module | Responsibility |
|---|---|
| `lib/core` | Domain types, decimal money, dates, seeded randomness, ids, errors, cross-module contracts |
| `lib/accounting` | `Ledger` (double entry, period locking, reversals), statements, integrity invariants, closing/correcting entries, depreciation, bank & subledger reconciliation, chart of accounts |
| `lib/finance` | `CalcResult` producers: margins, burn/runway, working capital, aging, variance, NPV/IRR/payback/break-even, fully loaded headcount cost, payroll reconciliation, ratios, scenario comparison |
| `lib/forecasting` | Driver detection, driver-based budget, rolling forecast, scenarios, 13-week cash flow (+ delayed receipt & stress test) |
| `lib/risk` | Rule-based GREEN/YELLOW/RED classifier, materiality thresholds, Phase One prohibited action kinds |
| `lib/approvals` | Approval requests with role routing and multi-approver RED, segregation of duties, `ActionExecutor` |
| `lib/audit` | Hash-chained, append-only audit log; "Why did the CFO do this?" explainer |
| `lib/security` | RBAC permission matrix, payroll redaction, secrets guard, signed sessions |
| `lib/academy` | Capability matrix (autonomy per capability), competency map, thresholds, promotion logic |
| `lib/knowledge` | Finance bible + unknowns registry, authoritative source registry, professional guidance store, policies, education snippets |
| `lib/retrieval` | BM25 index, hybrid retriever with provenance and stale flags |
| `lib/tax` | Tax rule store (rules are data with sources), calendar, workpapers, assumption registry, CPA review queue, document checklist, tax question guard |
| `lib/documents` | Document classifier, retention, missing-document alerts, receipt ↔ transaction matching |
| `lib/models` | `ReasoningModel`, `FastClassificationModel`, `VerificationModel`, `EmbeddingProvider`; Anthropic, OpenAI-compatible and local deterministic providers; fallback chain |
| `lib/agents` | Orchestrator, 11 specialists, tool registry, intent router, control guard, numeric guard, executive response composer |
| `lib/synthetic` | Deterministic synthetic S-corp (12+ months) with deliberately difficult cases and ground truth |
| `lib/monitors` | Event-driven monitors → Attention queue |
| `lib/workflows` | Weekly brief, 21-step month-end close, CPA package, CPA feedback ingestion, financial health |
| `evals` | Harness, scorers, generators (≥500 cases), results, readiness report |
| `app`, `components` | Dashboard UI and JSON API |
| `prisma`, `lib/db` | PostgreSQL schema, `PrismaStore`, `MemoryStore`, runtime wiring |

## 3. The request lifecycle ("Ask CFO")

1. **Actor & permission.** The session actor (OWNER, FINANCE_OPERATOR, CPA, VIEWER, …) is resolved
   from a signed cookie; RBAC decides what may be asked.
2. **Control guard.** Before any tool runs, the message is screened for instructions that
   violate controls (misclassify personal expenses, ignore missing receipts, pay without approval,
   alter closed periods, hide items from the CPA, sign/file, move money). Violations return
   `REFUSED_CONTROL_VIOLATION` with the compliant alternative. Nothing executes.
3. **Routing.** A structured task (`{kind, params}`) from a UI form or eval case is validated
   against the task catalog; free text is mapped by a deterministic intent router; the orchestrator
   delegates to specialists, and can fan out (health = controller + treasury + AR + auditor).
4. **Tools.** Specialists call zod-validated tools that wrap the engines. Every tool call is
   recorded (input/output fingerprints, risk level, duration).
5. **Governance.** Any action a tool proposes is risk-assessed. GREEN actions may auto-execute
   only if the capability's autonomy level allows; YELLOW/RED create approval requests. Phase One
   prohibited kinds (payments, payroll execution, tax filing, signing, entity changes, deletions)
   are blocked even when approved.
6. **Composition.** The executive response is assembled from tool results in the mandatory
   format: ANSWER / NUMBERS / WHY / WHAT CHANGES / RISKS / RECOMMENDATION / NEEDS APPROVAL /
   SOURCE & ASSUMPTIONS. High-risk topics carry FACT / CALCULATION / ASSUMPTION / PROFESSIONAL
   JUDGMENT. Optional LLM narrative is accepted only if a numeric guard confirms every number
   in it exists in the deterministic results.
7. **Audit.** One immutable event records actor, agent, model, prompt/workflow versions, tools,
   sources, calculations, proposed vs final action, approvals, confidence, before/after state.

## 4. Invariants enforced in code

- `Σ debits == Σ credits` for every journal entry; unbalanced entries throw.
- Posted entries cannot be edited or deleted; only reversed.
- LOCKED periods reject all postings; unlocking requires an approval and a reason and is
  recorded in period history.
- Balance sheet balances; opening cash + cash-flow activity = ending cash; AR/AP subledgers
  reconcile to GL control accounts; suspense must be zero before locking.
- Money is decimal (`DecimalString` in memory, NUMERIC(19,4) at rest).
- Unknown company facts are `null` with a status; they never become zero.
- Tax rules are data with a source and a review date; an unusable rule yields an escalation,
  never a remembered rate.
- Audit events are hash-chained; the chain is verifiable; the Postgres table has triggers that
  reject UPDATE/DELETE/TRUNCATE.

## 5. Model strategy

Different jobs use different models. Configure via environment:

| Role | Default | Used for |
|---|---|---|
| Reasoning | `claude-opus-5` | CFO narrative, complex accounting explanations |
| Fast classification | `claude-haiku-4-5` | Merchant normalization, document tagging, extraction |
| Verification | reasoning model | Independent review of high-risk work |
| Embeddings | OpenAI `text-embedding-3-small` or local hashed | Hybrid retrieval |

With no API keys the **local deterministic provider** serves all roles, so the whole lab,
test suite and evaluation harness run offline and reproducibly. Remote models fall back to the
next provider and finally to local on error, timeout or refusal; fallback events are recorded.

## 6. Autonomy model

Autonomy is per capability (`lib/academy/capabilities.ts`), from Level 0 (Untrained) to
Level 5 (Maximum Safe Autonomy). Promotion requires repeated passing evaluation runs meeting
thresholds on pass rate, false-action rate, hallucination rate, unsupported-source rate and
escalation accuracy (`lib/academy/certification.ts`). High-risk capabilities (tax, payroll
execution, payments, worker classification, accounting policy) cannot exceed Level 2 in Phase One
and require zero unauthorized-action failures.

## 7. Provider adapters (future phases)

`AccountingProvider`, `PayrollProvider`, `BankDataProvider` and `DocumentProvider` are adapter
interfaces selected in the setup wizard. Phase One ships only the internal accounting engine and
synthetic data. No live accounts are created. See `docs/PHASE_PLAN.md`.
