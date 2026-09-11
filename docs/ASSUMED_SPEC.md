# Finance Desk — working specification

> **Provenance.** The build request said "Read @SPEC.md completely". No `SPEC.md` existed in the
> repository (any branch), on GitHub, or in the session. This file is the specification the
> application was built against, reconstructed from the request text. Where the real SPEC.md
> differs, treat this file as the thing to diff against and file follow-ups.

> **Superseded in part (2026-09-11).** The assistant-first rebuild prompt supplied later takes
> precedence where it differs: the assistant is the default route, there are five destinations,
> the $8,000 allocation, compulsory travel goal and imposed budgets are gone, and take-home is
> derived from FICA + SDI + entered withholding. See `docs/ASSISTANT_FIRST_PLAN.md`.

## 1. Product

Finance Desk is a premium, mobile-friendly finance dashboard and AI assistant for three kinds of
money that must never be blended into one balance:

| Space | Who can see it by default | Purpose |
|---|---|---|
| **Company** | Will (owner) and Arielle (editor) | Service revenue, gross salaries, monthly allocations, taxes, overhead, distributions |
| **Household** | Both | Rent, cars, utilities, groceries, dining together; funded by company distributions |
| **Personal (Will, CEO)** | Will only | Take-home, personal goals, personal spending |
| **Personal (Arielle, Creative Director)** | Arielle only | Take-home, the friends-travel goal, her spending plan |

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
- $8,000/month is a **monthly operating allocation** for tools, equipment (Claude Max, ChatGPT
  Pro, a 2026 Mac mini) and apartment furnishing. No other employees are paid right now. Its
  business vs household split is **unresolved** and stays an editable field; the household part
  is an owner distribution, not a business expense.
- Will and Arielle each take a separate **$3,000 gross W-2 salary**. Net take-home is derived
  from an employee FICA rate (7.65%) plus an income-tax withholding estimate ($150–350, midpoint
  $250), never assumed.
- The household is funded by a **planned company distribution**, which stays unknown until set.
- Arielle's plan after the $1,000 travel goal is a spending plan: Shopping $700, Massage $300,
  Pedicure $100, Arts & crafts $200, Coffee/snacks/eating out with friends $200.
- The superseded $270,000 engineering salary is not used anywhere. $22,000/month of take-home is
  never assumed.
- Arielle's $1,000/month friends-travel goal is funded **before** personal discretionary spending.
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
| `/accounts` | Accounts, bills, spending budgets and goals per space; balances may be unknown |
| `/scenarios` | Proposed-purchase simulator: cash flow, runway, goal timelines |
| `/assistant` | Chat. Tool-computed results explained by Claude when a key is set, labelled deterministic previews otherwise |
| `/settings` | Company assumptions and allocations, people (roles, salaries, withholding), members and per-space roles, invite links (not sent), mode indicator, data export |

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
