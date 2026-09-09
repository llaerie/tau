# Tau AI CFO — Build Brief (read before writing code)

This repository is the **Phase One Training Lab** for an AI CFO operating system. It is a
production-oriented TypeScript / Next.js 15 / PostgreSQL / Prisma codebase. Phase One runs on a
**synthetic company only**. No real money moves. No real bank, payroll, tax, or accounting
integrations are live. Every subsystem must preserve that property.

## Non-negotiable engineering rules

1. **Money is never a JS number.** Use `DecimalString` and `lib/core/money.ts` (`D`, `add`, `sub`,
   `mul`, `div`, `money`, `cents`, `within`, ...). Persisted amounts are NUMERIC(19,4).
2. **The language model is never the calculator or the ledger.** All numbers come from
   deterministic code and are returned as `CalcResult` (`{ id, name, value, unit, formula, inputs,
   sourceIds, assumptions, asOfDate }`).
3. **Every journal entry must balance** (`total debits == total credits`) and posting into a LOCKED
   period must throw. Nothing may bypass `Ledger.createEntry/postEntry`.
4. **Unknown is unknown.** Unknown company facts are `ConfigField` with `value: null` and a
   `FieldStatus`. Never substitute zero, never invent a value. Synthetic data is labelled
   `isSynthetic: true`.
5. **RED actions never execute** without an APPROVED `ApprovalRequest` from an authorized role.
   In Phase One, payments, payroll execution, tax filing, signing, and entity changes are
   *always* blocked (simulation only), even if approved.
6. **Every meaningful action writes an immutable, hash-chained `AuditEvent`.**
7. **Tax rules are data, not memory.** `TaxRule` records must reference a `KnowledgeSource`
   (authoritative or professional). If a rule is missing or stale, the correct output is an
   escalation (`CPA_REVIEW_REQUIRED` / `INSUFFICIENT_INFORMATION`), not a guess.
8. **High-risk answers separate FACT / CALCULATION / ASSUMPTION / PROFESSIONAL JUDGMENT**
   (`ExecutiveResponse.highRisk`).
9. Deterministic behaviour: all randomness goes through `lib/core/random.ts` `SeededRandom`;
   ids for synthetic/eval data use `deterministicId()`.
10. Paths use the `@/` alias (`@/lib/core/types`). ESM only; do not use `__dirname` in .ts files
    without `fileURLToPath(import.meta.url)`.

## Shared contracts

- `lib/core/types.ts` — domain entities and `CompanyDataset`.
- `lib/core/contracts.ts` — `DataStore`, `LedgerEngine`, `RiskEngine`, `ApprovalEngine`,
  `AuditLog`, `CapabilityMatrix`, model interfaces, `Retriever`, `Tool`, `Agent`,
  `ExecutiveResponse`, `EvalCase`, ...
- `lib/accounting/chart-of-accounts.ts` — the lab chart of accounts and the `ACCT` code map.
- `lib/db/memory-store.ts` — in-memory `DataStore` used by tests and the lab.

## Folder ownership

| Folder | Purpose |
|---|---|
| `lib/accounting` | Ledger, statements, integrity checks, periods, close, depreciation, bank reconciliation |
| `lib/finance` | Deterministic financial calculation engine (`CalcResult` producers) |
| `lib/forecasting` | Budgets, rolling forecast, scenarios, driver-based models, 13-week cash flow |
| `lib/risk`, `lib/approvals`, `lib/audit`, `lib/security` | Governance |
| `lib/knowledge`, `lib/retrieval`, `lib/tax`, `lib/documents` | Knowledge layers, retrieval, tax control system, documents |
| `lib/models` | Provider-agnostic model interfaces + Anthropic / OpenAI / local deterministic providers |
| `lib/agents` | Orchestrator + specialist agents + tool registry |
| `lib/synthetic` | Synthetic S-corp dataset generator (12+ months) |
| `lib/monitors`, `lib/workflows` | Proactive monitors, weekly brief, month-end close, CPA package, education |
| `lib/academy` | Competency map, certification levels, thresholds, readiness report |
| `evals/` | Eval harness + ≥500 cases (generated from validated templates) |
| `app/`, `components/` | Next.js UI |
| `prisma/`, `lib/db` | Persistence |
| `tests/` | Vitest tests |

## Testing

`npm test` runs Vitest (`tests/**/*.test.ts`). Every engine must ship with tests. Tests must be
deterministic and must not need a database or network.

## Style

Strict TypeScript. No `any` unless unavoidable (then `// eslint-disable-next-line` with reason).
Small pure functions. Export an `index.ts` per folder. Keep files under ~600 lines.
