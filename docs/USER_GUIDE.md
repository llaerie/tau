# Finance Desk — user guide

## 1. Install and start

Requirements: Node 22 and pnpm 10 (`corepack enable` gives you pnpm).

```bash
pnpm install
```

### Demo mode (synthetic data, no accounts or keys)

```bash
pnpm demo                      # development server on http://localhost:3000
# or a production build:
pnpm build && pnpm start:demo
```

Open http://localhost:3000, pick **Alex** or **Sam**. Both are owners of the company and the
household; each sees only their own personal space. Everything you change is saved to
`./data/finance-desk.db`. **Settings → Reset demo data** restores the original synthetic set.

### Live mode (your real numbers)

```bash
export FINANCE_DESK_MODE=live
export AUTH_SECRET="$(openssl rand -hex 32)"      # required; keep it stable, it signs sessions
export FINANCE_DESK_DB=./data/finance-desk.db      # optional
export ANTHROPIC_API_KEY=sk-ant-...                # optional; enables Claude in the assistant
pnpm build && pnpm start                           # http://localhost:3000
```

You can put the same variables in `.env.local` (gitignored) instead of exporting them.

Notes for live mode:

- If `AUTH_SECRET` is missing or shorter than 32 characters you get a "Configuration needed"
  screen. There is no fallback to demo access.
- Session cookies are marked `Secure` in production builds. Browsers accept that on
  `localhost`, but if you serve the app to other devices over plain HTTP you will not be able
  to sign in. Put it behind HTTPS (Caddy, nginx, Tailscale Serve) or, on a trusted private
  network only, set `FINANCE_DESK_INSECURE_COOKIES=1`.
- The database is a single SQLite file. To back it up, stop the server and copy the `.db` file.

## 2. First-time setup in live mode

1. Open `/sign-in` → **Create account**. Enter your name, email, a password of 10+ characters,
   your company name, and your partner's first name. This creates the workspace, the company
   space, the household space, your private personal space, and a private personal space for
   your partner (they cannot see yours, you cannot see theirs).
2. You land on **Set up**. Fill in what you know and leave the rest blank:
   - each owner's gross monthly salary (gross, not take-home), a withholding estimate if you
     have one, other net income, and the monthly household contribution;
   - company revenue and whether it is anticipated or contracted, the employee allocation and
     its payroll classification (leave **Unresolved** until decided), employer payroll cost
     rate, income tax reserve rate, other overhead, reserve target, and the planned monthly
     distribution to the household.
   Blank means unknown. Unknown is shown as unknown everywhere and never treated as zero.
3. Go to **Accounts** and, for each space, add accounts with an opening balance and the date
   it was taken. Add recurring bills and goals (see section 4).
4. Invite your partner: **Settings → Invite links**, enter their name and choose their role on
   the company and household. Copy the link shown (`/sign-in?invite=…`) and send it yourself;
   the app never emails anyone. When they register with it they become owner of their own
   personal space and get the roles you chose. Links expire after seven days.

## 3. Finding your way around

Desktop: left sidebar. Phone: bottom bar with Overview, Company, Household, Me and **More**
(Transactions, Accounts, Scenarios, Assistant, Settings, sign out).

- **Overview** answers the five questions in order: business cash, commitments, what can fund
  the household, what each person has left after goals, and a link to scenarios. The top strip
  shows cash per space and is deliberately not summed.
- **Company**, **Household**, **Me** each show a monthly waterfall, goals, bills for the month,
  the month's actual ledger flows, accounts, and a six-month projection. Use ‹ › to change month.
- Every primary figure has **Where this comes from**: the formula, each input and where it is
  entered, the assumptions used, and caveats.
- A figure shown as **$X known so far · N unknown** is incomplete. Hover or open the provenance
  to see which items are missing. "Upper bound" means unknown costs will only lower it.

## 4. Accounts, bills and goals

**Accounts** (per space): name, type (checking, savings, credit card, cash, other), opening
balance and its date. Today's balance = opening balance + every transaction since that date.
Credit-card balances are shown separately and never mixed into cash. Archive an account you no
longer use.

**Bills**: recurring commitments. Cadence can be weekly, monthly, quarterly or annual; annual and
quarterly bills are converted to a monthly equivalent. A bill counts as committed until a
*bill payment* transaction is recorded for it in the month; then it is "Paid" and not counted
again. Leave the amount blank if you do not know it.

**Goals**: priority 1 is funded first; a lower priority goal only gets money after every higher
one is fully funded. Set the monthly contribution, an optional target total, and what is saved
so far to get "months to target". Alex's "Friends travel" goal is priority 1 with the rule
"funded before any discretionary spending"; set your own the same way.

## 5. Recording money

### Manual entry (Transactions → Add a transaction)

Pick the space, the kind, the date, the account and the amount. Kinds and what they mean:

| Kind | Counted as | Use for |
|---|---|---|
| Income | money in, once | salary deposits, client payments |
| Expense | spending, once, on the account charged (cards included) | purchases |
| Bill payment | spending, once, and marks the bill paid for the month | rent, subscriptions |
| Transfer between own accounts | never spending; a contribution only when it crosses spaces | personal → joint account |
| Credit-card payment | never spending (charges were counted when they happened) | paying the card |
| Savings allocation | never spending; goal progress | moving money to a savings goal |
| Payroll withholding | informational only; shows gross → net | the withheld part of a paycheck |

Transfers, card payments and savings allocations need a **To account**; you can choose an
account in another space you can see (that is how a household contribution is recorded).
Reclassify a row with the dropdown at its right, or delete it with ✕.

### CSV import (Transactions → Import CSV)

1. Choose the account the statement belongs to and pick the CSV file from your bank.
2. **Preview**: date, description and amount (or debit/credit) columns are detected. Tick
   "positive amounts mean money out" if your bank exports that way.
3. Fix each row's kind (negative amounts default to Expense, positive to Income) and choose a
   receiving account for anything that is a transfer, card payment or savings move.
4. **Import**. Rows already in the ledger (same date, amount and description) are marked
   duplicate and skipped, so re-importing an overlapping statement is safe.

## 6. Scenarios

**Scenarios → Propose a purchase**: what, which space, amount, one-time or monthly, how many
months, and when it starts. The result shows the cash path with and without it, the lowest cash
point, and each goal's funding before and after. Recurring costs come out of the money that
funds goals, lowest priority first, so the priority-1 goal is protected as long as possible.
Verdicts: **Affordable**, **Affordable but goals slip**, **Creates a shortfall**, or **Cannot
tell yet** when an input is unknown. Nothing is adjusted to make a purchase fit.

## 7. Assistant

Ask in plain language: "What can the company put toward the household?", "Can I afford a $1,800
laptop this month?", "What is still unknown?", "What did the household spend last month?".

- With `ANTHROPIC_API_KEY` set, Claude picks the tools, and the reply is labelled
  **Claude · tool-computed**. Every number comes from the tools listed under the reply.
- Without a key, replies are labelled **Deterministic preview · no model connected**: the
  question is routed to the same tools and rendered with fixed wording.

The assistant only sees spaces you can see, and it cannot move money or change anything.

## 8. Settings

Company assumptions and each owner's assumptions (a person can edit their own; workspace owners
can edit anyone's), members and per-space roles (owner / editor / viewer / no access; personal
spaces cannot be shared), invite links, JSON export of everything you are allowed to see, reset
demo data (demo mode only), sign out.

## 9. A monthly routine

1. Import or enter the month's transactions for each space; mark bills as bill payments.
2. Check **Overview**: is anything "unknown" that you now know? Enter it in Settings.
3. Review the household surplus or shortfall and decide contributions or a company
   distribution; see Company for what is genuinely available after commitments.
4. Model any purchase you are considering in Scenarios before committing to it.

## 10. When something looks wrong

- **404 on a personal page**: that space belongs to someone else; this is intended.
- **"Configuration needed"**: `FINANCE_DESK_MODE` is unset or live mode lacks `AUTH_SECRET`.
- **A figure is $0 "known so far"**: the inputs it depends on are all unknown; open the
  provenance to see which.
- **Cannot sign in over the network in live mode**: see the cookie note in section 1.
- **Checks**: `pnpm check` runs unit tests, typecheck, lint, build and the end-to-end suite.
