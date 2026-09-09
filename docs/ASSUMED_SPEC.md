# Finance Desk — working specification

> **Provenance.** The build request said "Read @SPEC.md completely". No `SPEC.md` existed in the
> repository (any branch), on GitHub, or in the session. This file is the specification the
> application was built against, reconstructed from the request text. Where the real SPEC.md
> differs, treat this file as the thing to diff against and file follow-ups.

## 1. Product

Finance Desk is a premium, mobile-friendly finance dashboard and AI assistant for three kinds of
money that must never be blended into one balance:

| Space | Who can see it by default | Purpose |
|---|---|---|
| **Company** | Both owners | Service revenue, employees/payroll, taxes, overhead, owner salaries |
| **Household** | Both partners | Shared bills, shared goals, funded by each person's contribution |
| **Personal (Alex)** | Alex only | Take-home, personal goals, personal spending |
| **Personal (Sam)** | Sam only | Take-home, personal goals, personal spending |

The spaces connect through classified transactions (a company payroll expense becomes a personal
income; a personal transfer becomes a household contribution), scoped permissions, and
consolidated views that show each space's number side by side, never summed into one pot.

## 2. Questions the dashboard must answer

1. What cash belongs to the business.
2. What is already committed to employees, payroll, taxes, and bills.
3. What can fund the shared household.
4. What each person actually has available after personal goals.
5. How a proposed purchase changes cash flow and savings goals.

## 3. Financial rules (non-negotiable)

- $30,000/month is **anticipated** company service revenue. It is never personal take-home pay.
- $8,000/month is the **stated employee allocation**. Its payroll classification (W-2 gross,
  contractor, or gross plus employer payroll costs) is **unresolved** and stays an editable field.
- The two proposed $3,000 owner salaries are **gross**. Net take-home is unknown until
  withholding assumptions are entered.
- The superseded $270,000 engineering salary is not used anywhere. $22,000/month of take-home is
  never assumed.
- Alex's $1,000/month friends-travel goal is funded **before** personal discretionary spending.
- Unknown taxes, payroll costs, overhead, and balances stay **unknown**. They are never coerced to
  zero; every subtotal that depends on an unknown says so and reports a "known so far" figure.
- Shortfalls are shown as shortfalls. Assumptions are never adjusted to make a budget look
  affordable.
- No double counting: internal transfers, credit-card payments, payroll withholding, savings
  allocations, and paid bills are classified so each dollar is counted once.
- All financial numbers come from deterministic, unit-tested functions in `src/lib/finance`.
  The language model only explains tool outputs.

## 4. Screens (first version)

| Route | Screen |
|---|---|
| `/sign-in` | Demo persona picker (demo mode) or email + password sign-in / registration (live mode) |
| `/onboarding` | Editable assumptions: revenue, employee allocation and classification, owner salaries, tax and payroll estimates (unknown by default), balances, goals |
| `/` | Overview: the five questions, one section each, with provenance for every number |
| `/company` | Company cash waterfall, commitments, reserves, bills, 6-month projection chart |
| `/household` | Household funding, bills, shared goals, contribution split |
| `/personal/[person]` | Personal take-home waterfall, goals in priority order, discretionary, private |
| `/transactions` | Ledger with filters, manual entry, CSV import, classification, transfer matching |
| `/accounts` | Accounts per space with balances (unknown allowed) and "as of" dates |
| `/scenarios` | Proposed-purchase simulator: cash flow, runway, goal timelines |
| `/assistant` | Chat. Tool-computed results explained by Claude when a key is set, labelled deterministic previews otherwise |
| `/settings` | Workspace, members and per-space roles, invite links (not sent), mode indicator, data export |

## 5. Modes

- **Demo**: `FINANCE_DESK_MODE=demo`. Synthetic data labelled "Synthetic demo data" on every
  screen. Persona sign-in without a password. Changes persist in the local SQLite file.
- **Live**: `FINANCE_DESK_MODE=live`. Requires `AUTH_SECRET`. Email + password accounts (scrypt),
  signed HTTP-only session cookies, per-space roles enforced server-side on every read and
  write, private SQLite storage. Demo sign-in returns 403. A missing secret is a startup error,
  never a fallback to demo.

## 6. Integrations

Manual entry and CSV import only. No bank, payroll, accounting, or payment integrations are
connected, and the UI says so. The application never initiates payments, runs payroll, files
taxes, purchases services, or sends invitations.

## 7. Stack

Next.js 15 (App Router, server actions, route handlers), React 19, TypeScript strict, Tailwind
CSS 4, Drizzle ORM on SQLite (better-sqlite3), Zod, Recharts, Vitest, Playwright, ESLint, the
official `@anthropic-ai/sdk` for the assistant.
