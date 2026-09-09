# Implementation plan

Stages, each verified before moving on. Status lives in `CHECKLIST.md`.

1. **Scaffold** — Next.js 15 + TypeScript + Tailwind 4, Drizzle/SQLite, Vitest, Playwright, ESLint.
2. **Finance engine** (`src/lib/finance`) — pure functions, no I/O:
   - `money.ts`: integer cents, `Known | Unknown` amounts, sums that keep unknowns unknown.
   - `assumptions.ts`: the editable assumption set and its defaults (unknowns default to unknown).
   - `classify.ts`: transaction kinds and the single-count rules (transfers, CC payments,
     withholding, savings allocations, bill payments).
   - `company.ts`: cash waterfall: anticipated revenue → employee allocation → owner gross
     salaries → payroll costs (unknown unless estimated) → tax reserve (unknown unless
     estimated) → overhead bills → distributable to household.
   - `personal.ts`: gross → withholding (unknown unless estimated) → net → goals in priority
     order (friends-travel first) → fixed personal bills → discretionary; shortfalls reported.
   - `household.ts`: contributions from each person and company distributions → bills → shared
     goals → surplus/shortfall; contribution split.
   - `scenario.ts`: a proposed purchase applied to a space: cash-flow delta, runway change,
     goal-timeline delay, shortfall flags.
   - `projection.ts`: month-by-month cash projection per space.
   - `csv.ts`: CSV parsing with header mapping, de-duplication hash.
   - Unit tests for every module, including the critical rules from the request.
3. **Data layer** — Drizzle schema, migrations applied at startup, demo seed with labelled
   synthetic data, repository functions that always take a `Viewer` and filter by permission.
4. **Auth & modes** — session cookies signed with HMAC (`AUTH_SECRET`), scrypt password
   hashing, demo persona sign-in only in demo mode, `requireSpaceAccess` guard used by every
   server action and route handler.
5. **UI** — app shell with desktop sidebar and mobile bottom nav, calm warm palette, provenance
   drawer for every primary metric, screens listed in `docs/ASSUMED_SPEC.md`.
6. **Assistant** — tools that call the engine; Claude tool-use loop when `ANTHROPIC_API_KEY` is
   set; labelled deterministic preview otherwise.
7. **Verification** — unit tests, typecheck, lint, e2e (desktop + mobile), production build,
   screenshots reviewed; fix and commit.
