# Assistant-first rebuild: architecture and migration note

Prepared 2026-09-11 against branch `claude/finance-desk-app-f6yoqf` at commit `0e86844`.

## What the audit found

Working today: persistent SQLite via Drizzle, demo persona sign-in, live password accounts with
server-side per-space roles, manual entry and CSV import, a deterministic finance engine with 57
unit tests, a dashboard-first UI (Overview, Company, Household, Personal, Transactions, Accounts,
Scenarios, Assistant, Settings), a Claude tool-use adapter (non-streaming, verified once with a
real key in-session) and a deterministic preview when no key is set.

Not working or absent: action approval and idempotency (server actions write immediately),
receipts and documents, splits, voice, dark mode, a facts registry with provenance, subscription
and purchase-plan records, SDI in payroll, partner summaries (personal spaces are simply hidden),
credit-card-vs-cash semantics were correct in the engine but not labelled in the UI.

Databases in this environment: `data/*.db` are local demo and test files only. No live database
exists here. Live databases on user machines, if any, hold version-2 assumptions and the earlier
template's goals/budgets.

## Financial corrections in this rebuild

- Facts registry (`plan_facts`): versioned, effective-dated, with provenance (`owner_stated`,
  `demo`, `user_edited`, `import`) and superseded entries kept.
- Forward payroll plan: exactly two $3,000 gross salaries. Employee withholding (FICA 7.65%,
  CA SDI 1.3%, income-tax estimate) is part of gross, never a second expense. Employer costs are
  separate and may be unknown. Take-home is "verified" only from pay-stub/provider data.
- The $8,000 allocation is retired and archived as superseded. Replaced by itemized records:
  four planned AI subscriptions (tier and price to confirm), metered API usage, other SaaS rows,
  a one-time hardware quote and a one-time furniture plan.
- Rent $5,800 and two Teslas $1,200 combined are household bills whose intended payer is the
  company; each payment is one economic event with payer, beneficiary, purpose and accounting
  treatment kept separate ("review required" by default, never a silent deduction).
- No flat $5,000 tax. Tax reserves stay unknown with source/year/review fields; the CA S-corp
  1.5% / $800 minimum rule is recorded as a rule needing applicability review.
- The $17,000 partial cash-planning remainder is shown only in the money-plan detail with its
  exact label.
- Food is a per-person target funded from take-home; spent comes from expense shares (splits),
  allocated/spent/unspent are separate; optional personal allocations are user-defined.
- Old compulsory travel goal and imposed category budgets are not seeded; existing user-edited
  goals are preserved and listed for review, never deleted.

## Data migration

- Assumptions JSON: v2 → v3 parse migration is additive and non-destructive; the previous JSON is
  written to `assumption_history` with a provenance note before the first v3 save.
- Schema migration `0002`: new tables (`assumption_history`, `subscriptions`,
  `purchase_plans`, `expense_shares`, `documents`, `actions`, `audit_log`, `user_preferences`),
  new nullable columns on `transactions` and `bills`. No rows are deleted.
- Demo workspace: seed version 3 replaces the synthetic set (demo only, detected by `is_demo`).
- Live workspaces: never reseeded. Settings → Plan review shows a diff of superseded defaults
  (allocation, goals, budgets) with per-item archive actions that require approval.
- Export: `/api/export` remains available as the pre-migration backup path.

## Delivery order

1. Skills vendored, audit, this note.
2. Facts registry, payroll/cash-plan engines, regression tests.
3. Schema + migration + demo seed v3 + template.
4. Tokens (light/dark), shell with five destinations, assistant home.
5. Assistant adapter (streaming, cancellation, retries), tools, envelope, preview mode.
6. Actions: draft → preview → approve → apply (idempotent), receipts, splits, plans.
7. Money, Activity, Documents, Settings.
8. Voice push-to-talk and spoken replies.
9. Privacy tests, e2e journeys, visual review in both themes, docs.

## Status (2026-09-11)

All nine steps are implemented and verified with the repo's own scripts (see CHECKLIST.md).
Facts are held in `src/lib/assumptions.ts` (v3) and `src/lib/db/template.ts` rather than a
separate `plan_facts` table; the migration therefore creates eight tables, not nine.

### Rollback / export

1. Before upgrading a live database: download `/api/export` per user and copy the SQLite file.
2. To roll back: stop the server, restore the copied file, check out the previous commit. The
   0002 migration is additive, so the previous build also runs against a migrated file.
3. Superseded assumptions remain visible under Settings → Plan review; nothing is deleted.
