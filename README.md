# Finance Desk

An assistant-first finance workspace for a small California S corporation (Will, CEO), the
shared household of its two people, and each person's private money (Will; Arielle, Creative
Director). Company, household and the two personal spaces stay separate. The default screen is
the assistant; Money, Activity, Documents and Settings sit behind it.

Every figure the app shows is computed by a deterministic engine, labelled (recorded, expected,
estimate, verified, unknown), and explainable in one click. Unknown inputs stay unknown and are
never treated as zero. The assistant reads and drafts; it never pays, moves money, changes
payroll, or buys subscriptions.

> The original `SPEC.md` was never in the repository; the reconstructed version is
> [`docs/ASSUMED_SPEC.md`](docs/ASSUMED_SPEC.md). The assistant-first rebuild follows the
> uploaded rebuild prompt; its audit, corrections and migration notes are in
> [`docs/ASSISTANT_FIRST_PLAN.md`](docs/ASSISTANT_FIRST_PLAN.md) and the design review in
> [`docs/design-review.md`](docs/design-review.md). Owner instructions:
> [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md).

## Run the demo (verified command)

```bash
pnpm install
pnpm build && pnpm start:demo      # http://localhost:3000, synthetic data, persona sign-in
# or, for development with hot reload:
pnpm demo
```

Sign in as **Will** or **Arielle**. The demo seeds `./data/finance-desk.db` with the owner-stated
plan (two $3,000 gross salaries, $30,000 anticipated receipts, company-paid rent $5,800 and cars
$1,200, four subscriptions with tiers to confirm, two unpriced one-time purchases) plus clearly
synthetic balances and entries. **Settings → Reset demo data** restores it. Live workspaces are
never reseeded.

## Live setup

```bash
export FINANCE_DESK_MODE=live
export AUTH_SECRET="$(openssl rand -hex 32)"     # required, 32+ chars, keep it stable
export FINANCE_DESK_DB=./data/finance-desk.db     # optional private SQLite file
pnpm build && pnpm start                          # http://localhost:3000
```

Live mode uses email + password accounts, signed HTTP-only cookies, per-space roles enforced on
the server for every read, action, file and API route, and private SQLite storage. Demo persona
sign-in is refused. A missing `AUTH_SECRET` is a startup error, never a demo fallback. Owners
create invite links in Settings and share them themselves; Finance Desk sends nothing.

## Model and voice configuration checklist (no secrets in the repo)

| Item | Where | Effect |
|---|---|---|
| `ANTHROPIC_API_KEY` | server environment only | Enables the Claude adapter: streaming answers, Stop button, two automatic retries, 60 s timeout. Without it the assistant runs in **Preview mode**: the same server-side tools with fixed wording, labelled as previews, plus a "Connect assistant" control. |
| `FINANCE_DESK_MODEL` | server environment | Optional model id (default `claude-opus-5`). |
| Push-to-talk | browser | Uses the browser's Web Speech API only while the microphone button is held. Transcript is shown before sending. Unsupported browsers see "Voice unavailable here"; denied permission shows a message and typing keeps working. |
| Spoken replies | Settings → Assistant & voice, or the toggle under the composer | Browser speech synthesis, off by default, Mute button while speaking. Saved per user. |
| Theme | Settings → Appearance | System / light / dark, saved per user and in the `fd_theme` cookie. |

Money figures never come from the model; they come from tools that call the finance engine, and
the model only narrates them. The partner's private rows never enter the other user's model
context.

## Destinations

| Route | What it is |
|---|---|
| `/` | Assistant: briefing, ≤3 attention items, upcoming payments, conversation, composer with starters ("What can I spend?", "Record a receipt", "Plan a purchase") and scope (My money / Company / Household). |
| `/money?space=me|company|household|partner` | Take-home with withholding status, food target and spending, optional allocations, company cash plan with the exact partial-remainder label, subscriptions, dated one-time purchases, household bills paid by the company vs from the joint account, and the partner's coarse shared summary. |
| `/activity` | Everything recorded in the spaces you can see: search, filters, detail drawer, split, void with reason, record an expense, CSV import. |
| `/documents` | Upload receipts/quotes/statements per space; review a digital receipt and record it (with an equal split) through a preview. |
| `/settings` | Profile and privacy (share a coarse summary), appearance, assistant and voice, integrations (none, with instructions), payroll, company/tax/budget assumptions, plan review (open items, superseded assumptions, archivable template records), members, invites, export, demo reset. |

Old routes (`/company`, `/household`, `/personal/:id`, `/transactions`, `/accounts`,
`/scenarios`, `/assistant`, `/overview`, `/more`, `/onboarding`) redirect.

## Reviewed actions

Budget changes, receipts and expenses, equal food splits, purchase plans, subscription record
changes, voids and archives all follow **draft → preview → approve → apply**. Apply is idempotent
(a unique idempotency key and status check), records an audit-log row, and approval must quote
the draft version. Nothing is deleted; entries are voided with a reason.

## Migration and rollback

- Schema migration `drizzle/0002_assistant_first.sql` adds tables (`subscriptions`,
  `purchase_plans`, `expense_shares`, `documents`, `actions`, `audit_log`,
  `assumption_history`, `user_preferences`) and nullable columns. It deletes nothing and runs at
  startup.
- Assumptions JSON v1/v2 are migrated in memory to v3; the first save archives the previous JSON
  to `assumption_history` with provenance. Superseded values (the old $8,000 allocation, the old
  flat tax rate) are listed under Settings → Plan review with dates and reasons.
- Rollback: stop the server, restore the SQLite file from your backup (`/api/export` produces a
  JSON export of everything you can see before you migrate), and check out the previous commit.
  The migration is additive, so the previous build can also run against the migrated file.

## Checks

```bash
pnpm test        # 78 unit tests: engines, payroll, splits, cash plan, action engine, privacy, preview router
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e    # Playwright, desktop + mobile: journeys A–K, themes, redirects, privacy, live mode
pnpm check       # all of the above
```

Professional accounting and tax review are not replaced by this app; tax figures stay unknown
until a CPA-reviewed value is entered.
