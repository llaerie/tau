# Tau — AI CFO Operating System (Phase One: Training Lab)

Tau is an AI finance organization for a small company: a CFO orchestrator, eleven specialist
finance agents, a deterministic accounting and financial calculation engine, a controlled tax and
knowledge system, a risk/approval/audit layer, and a CFO Academy that measures competence before
granting autonomy.

**Phase One runs on a synthetic company only.** No bank, payroll, accounting, invoicing or tax
service is connected. No money moves. Nothing is filed or signed. Every page and report says so.

> **Not production-ready.** The readiness report (`docs/READINESS_REPORT.md`) is generated from the
> evaluation suite and lists certified, approval-required and prohibited capabilities, failed cases,
> missing company data and required professional reviews. A complete UI does not make the system
> ready; measured evaluation performance and confirmed company facts do.

## What it does today

- Maintains a double-entry ledger with period locking, reversals, closing and correcting entries,
  depreciation, accruals, prepaids, and bank/subledger reconciliation.
- Produces the income statement, balance sheet and cash flow statement, with integrity invariants
  (entries balance, balance sheet balances, cash flow reconciles, subledgers tie).
- Runs a 13-week cash flow with delayed-receipt and stress scenarios, a driver-based budget, a
  rolling forecast, variance analysis, and corporate-finance calculations (NPV, IRR, payback,
  break-even, fully loaded headcount cost).
- Answers questions through a CFO console in a fixed executive format (ANSWER, NUMBERS, WHY, WHAT
  CHANGES, RISKS, RECOMMENDATION, NEEDS APPROVAL, SOURCE & ASSUMPTIONS); high-risk topics are split
  into FACT / CALCULATION / ASSUMPTION / PROFESSIONAL JUDGMENT.
- Refuses control violations before running any tool ("classify my apartment as office rent",
  "ignore the missing receipt", "pay this vendor without approval", "change last December's books",
  "mark the salary reasonable", "don't tell the CPA").
- Classifies every action GREEN / YELLOW / RED, routes approvals to the right roles, and blocks
  payments, payroll execution, tax filing, signing, entity changes and deletions in Phase One even
  when approved.
- Writes a hash-chained, append-only audit trail that answers "Why did the CFO do this?".
- Keeps every unknown fact about the real company explicit in "Complete the Finance Setup" (26
  items), and never converts an unknown into a number.
- Treats tax rules as data with sources and review dates; with no retrieved rule the correct output
  is an escalation to the CPA, not a remembered rate.
- Generates the weekly CFO brief, a 21-step month-end close simulation, and a CPA package, and
  ingests CPA feedback into versioned company policy.
- Runs a 500+ case evaluation suite across nine directories and promotes capabilities only after
  repeated passing runs against per-capability thresholds.

## Quick start

```bash
npm install
npm run lab:seed      # synthetic company → .tau/lab-snapshot.json
npm run dev           # http://localhost:3000
npm test              # engine, governance, agent, workflow and harness tests
npm run evals         # CFO Academy evaluation suite (exit 1 on any failure)
npm run evals:report  # docs/READINESS_REPORT.md
```

No API keys are needed: a deterministic local model provider serves every model role, so the lab,
tests and evaluations are reproducible offline. See `docs/OPERATIONS.md` for PostgreSQL, providers
and roles.

## Layout

```
app/            Next.js dashboard (Overview, CFO, Company, Transactions, Accounting, Cash,
                Budget & Forecast, Payroll, AP, AR, Tax, Documents, Reports, Approvals,
                CFO Academy, Audit, Settings) and JSON API
components/     UI components
lib/core        Types, contracts, decimal money, dates, seeded randomness
lib/accounting  Ledger, statements, integrity, periods, closing, depreciation, reconciliation
lib/finance     Deterministic calculation engine (every result is a CalcResult with formula,
                inputs, sources, assumptions)
lib/forecasting Budgets, rolling forecast, scenarios, 13-week cash flow
lib/risk lib/approvals lib/audit lib/security   Governance
lib/academy     Capability matrix, competency map, certification thresholds
lib/knowledge lib/retrieval lib/tax lib/documents  Knowledge layers, retrieval, tax control system
lib/models      Provider-agnostic model interfaces (Anthropic, OpenAI-compatible, local)
lib/agents      Orchestrator, specialists, tools, control guard, numeric guard
lib/synthetic   Synthetic S-corp generator with 29 ground-truth difficult cases
lib/monitors lib/workflows  Attention queue, weekly brief, month-end close, CPA package
lib/integrations Adapter interfaces for future providers (not connected)
evals/          Harness, scorers, case generators, results, readiness report
prisma/ lib/db  PostgreSQL schema, PrismaStore, MemoryStore, runtime wiring
knowledge/      Finance bible notes, authoritative source registry, guidance, education
docs/           Architecture, security, operations, phase plan, readiness report
tests/          Vitest suites
```

## Documentation

- `docs/GETTING_STARTED.md` — owner's guide: create your company workspace, logins, first hour
- `docs/ARCHITECTURE.md` — layers, request lifecycle, invariants, model strategy, autonomy model
- `docs/SECURITY.md` — implemented controls and what is required before real data
- `docs/OPERATIONS.md` — how to run, commands, PostgreSQL, providers, roles, backups
- `docs/PHASE_PLAN.md` — Phases One to Five and their gates
- `docs/READINESS_REPORT.md` — generated from the latest evaluation run
- `docs/BUILD_BRIEF.md` — engineering rules every module follows

## Known company facts vs unknowns

The real company is a California LLC taxed as an S corporation with one owner, three U.S. and two
China-based workers, and roughly $30,000/month of service revenue whose payer is associated with the
CEO's father (flagged related-party for review). Everything else — legal name, EIN reference, bank
accounts, cards, payroll provider, CPA responsibilities, compensation basis, worker classification,
invoicing process, fiscal year, accounting method, opening balances, and more — is recorded as
UNCONFIRMED or PROFESSIONAL_REVIEW_REQUIRED and listed in Company → Complete the Finance Setup. The
synthetic lab company ("Northlight AI Services LLC") resembles this profile but its numbers are not
the company's numbers.
