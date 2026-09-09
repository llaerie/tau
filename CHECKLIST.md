# Finance Desk — build checklist

Legend: `[x]` todo · `[~]` in progress · `[x]` done and verified

## Stage 1 — Scaffold
- [x] Next.js 15 / TS / Tailwind 4 / pnpm scaffold (git history preserved)
- [x] Drizzle + better-sqlite3, Vitest, Playwright 1.56 (matches installed Chromium), ESLint
- [x] `docs/ASSUMED_SPEC.md`, `docs/PLAN.md`, this checklist, `.env.example`

## Stage 2 — Finance engine (pure, tested)
- [x] Money / Unknown arithmetic
- [x] Assumptions model with unknown-by-default fields
- [x] Transaction classification without double counting
- [x] Company waterfall
- [x] Personal waterfall with goal priority (friends-travel before discretionary)
- [x] Household funding
- [x] Purchase scenario
- [x] Monthly projection
- [x] CSV parsing
- [x] Unit tests green

## Stage 3 — Data layer
- [x] Schema + startup migration
- [x] Demo seed (labelled synthetic data)
- [x] Permission-scoped repositories

## Stage 4 — Auth and modes
- [x] Sessions, password hashing, demo persona sign-in (demo only)
- [x] Live mode refuses to run without AUTH_SECRET; no demo fallback
- [x] Server-side authorization on every action / route

## Stage 5 — Screens
- [x] App shell (desktop sidebar, mobile bottom nav)
- [x] Sign-in, onboarding/settings assumptions
- [x] Overview with provenance
- [x] Company, Household, Personal ×2
- [x] Transactions: list, filters, manual entry, CSV import
- [x] Accounts
- [x] Scenarios
- [x] Settings: members, roles, invite links, mode, export

## Stage 6 — Assistant
- [x] Engine-backed tools
- [x] Claude tool-use loop when key present
- [x] Labelled deterministic preview when absent

## Stage 7 — Verification
- [x] `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm test:e2e`
- [x] Desktop + mobile screenshots reviewed, overflow fixed
- [x] Committed and pushed to `claude/finance-desk-app-f6yoqf`
