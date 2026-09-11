# Finance Desk — owner guide

## Start

```bash
pnpm install
pnpm build && pnpm start:demo    # synthetic demo at http://localhost:3000
```

Live mode (real numbers) needs `FINANCE_DESK_MODE=live` and a 32+ character `AUTH_SECRET`; see
the README. Put variables in `.env.local` if you prefer a file. The database is a private SQLite
file; back it up by copying it, or download `/api/export` (JSON of everything you can see).

## The four moves: ask, review, approve, inspect

**Ask.** The first screen is the assistant. Type, or hold the microphone to talk (the transcript
appears before you send it). Pick a scope: *My money*, *Company* or *Household*. Starters:
"What can I spend?", "Record a receipt", "Plan a purchase". Examples that work in preview mode
and with Claude:

- "How much can I spend on food?"
- "Set my food budget to $1,200"
- "Record a $42.50 dinner receipt, split with Will"
- "Can the company buy a $2,000 computer next month?"
- "Add a $3,000 sofa paid by the company"
- "What are all our AI tools costing?"
- "What is due in the next 30 days?"
- "The company payment is delayed this month"

**Review.** Anything that would change data appears as a card: what changes (before → after),
what it will *not* do, warnings such as "company-paid personal items are not deductible by
default", and a privacy note for splits. Nothing is saved yet.

**Approve.** Press *Approve and apply*. It saves exactly once; pressing again, or asking the same
thing again, does not duplicate the record. *Cancel* discards the draft. Applied actions are
listed in the audit log and voidable from Activity with a reason (never deleted).

**Inspect.** Every figure in Money and every assistant result has *View calculation*: formula,
inputs with their sources, as-of date, assumptions and caveats. Unknown inputs are named and are
never treated as zero.

## What the figures mean

- **Gross salary** ($3,000 each) is not spendable cash.
- **Take-home** = gross − employee FICA (7.65%) − California SDI (1.3%) − income-tax withholding.
  It is *incomplete* until withholding is entered, an *estimate* if you typed a figure, and
  *verified* only from a pay stub or the payroll provider (Settings → Payroll).
- **Food target** is your own planning capacity; it is subtracted once from take-home and your
  actual food spending is tracked against it. Split meals count only your share.
- **Left after plan** = take-home − fixed personal bills − household contribution − food target −
  optional allocations you chose (savings, investment, a spending pot). Nothing is imposed.
- **Company: partial cash-planning remainder before unlisted employer costs, taxes, insurance,
  software, purchases and reserves** = expected receipts − known recurring commitments. It is not
  profit, not a balance and not safe to spend. Expected receipts are not cash until a deposit is
  recorded.
- **Rent ($5,800) and the two Teslas ($1,200)** are paid by the company for the household: shown
  as company cash out, beneficiary household, purpose personal, accounting treatment *review
  required*. They are not deductible business expenses by default and not household income.
- **Subscriptions**: two Claude and two ChatGPT seats are planned with tier and price to confirm;
  API usage is a separate metered cost. Confirm tiers under Money → Company.
- **Taxes** stay unknown until a CPA-reviewed reserve is entered. There is no flat tax figure.

## Privacy

Your personal space (accounts, entries, receipts, targets, chat history) is private. Your partner
sees only a coarse monthly summary if you leave sharing on (Settings → Profile & privacy): food
status, take-home status, savings allocations rounded to $50. Never merchants, dates, categories
or amounts. This is enforced on the server for pages, files, exports and the assistant's tools.

## Setup that improves the answers

1. Settings → Payroll: enter withholding from a pay stub and choose the source.
2. Money → My money: set a food target (or ask the assistant to).
3. Money → Company: confirm subscription tiers and prices; give one-time purchases a price and a
   month.
4. Settings → Company, tax & budget: employer payroll cost rate, other overhead, tax reserve once
   reviewed, reserve target.
5. Documents: upload receipts and record them; Activity: import bank CSVs.

## Voice

Push-to-talk uses your browser's speech recognition and listens only while the button is held.
Spoken replies use the browser's speech synthesis and are off by default; there is a Mute button
while speaking. If your browser does not support either, the app says so and typing works as
usual.
