# Getting Started (for the owners)

This guide sets up Tau on your own computer for your company. It takes about ten minutes.
Nothing connects to your bank, card, payroll or tax accounts. The system only knows what you tell
it or import.

## 1. Install

You need Node.js 20 or newer (https://nodejs.org). Then, in a terminal:

```bash
git clone <this repository>
cd tau
npm install
cp .env.example .env
```

Open `.env` and set:

```
TAU_WORKSPACE=company
TAU_SESSION_SECRET=<a long random string>
```

Leave the model keys blank. The CFO computes every number itself; a model key only changes the
wording of explanations and is not needed.

## 2. Create your company workspace

```bash
npm run company:init
```

This creates an empty set of books for your company at `.tau/company-snapshot.json`. It already
contains what you have told us (California LLC, S corporation election, five workers, one related-
party customer) and lists the 26 things it does not know yet. It contains no synthetic numbers.

## 3. Create the two logins

```bash
npm run users:add -- --email you@example.com --name "Your Name" --role OWNER
npm run users:add -- --email operator@example.com --name "Finance Operator" --role FINANCE_OPERATOR
```

Each command asks for a password (12 characters or more). The Finance Operator can approve
routine (YELLOW) items but never high-risk (RED) ones; RED items always wait for the owner and,
where relevant, your CPA or attorney.

## 4. Start it

```bash
npm run build
npm start
```

Open http://localhost:3000 and sign in.

## 5. First hour in the app

1. **Company → Complete the Finance Setup.** Answer what you know: legal name, bank accounts and
   cards, payroll provider, invoicing process, payment terms, insurance. Leave anything uncertain
   blank; the CFO will keep it marked unknown rather than guess.
2. **Company → International workforce.** Read the review checklist for the two China-based
   workers. Do not fill in classification yourself; it is flagged for your CPA and attorney.
3. **Transactions → Add transaction** to begin entering bank and card activity by hand until an
   importer for your bank's CSV export is added (tell us which bank and we will build it).
4. **CFO → Ask CFO.** Try "What do you still need from me?", "What is our cash position?", or
   "Is $3,000 a month a reasonable salary for me?". Expect honest answers: unknown cash stays
   unknown, and the salary question is routed to your CPA with the facts assembled.
5. **Reports → CPA package** when you are ready to hand your CPA a first package. Everything the
   AI assumed is labelled as an assumption.

## What it will not do

It will not move money, run payroll, file or sign anything, respond to the IRS or FTB, change your
entity, delete records, or treat an unknown as zero. Those are enforced in code, not just policy.

## The synthetic lab

`TAU_WORKSPACE=lab` switches to the training company used for evaluations. It is a separate file
(`.tau/lab-snapshot.json`) and never mixes with your company workspace.

## Backups

Your books are the single file `.tau/company-snapshot.json`. Copy it somewhere safe regularly.
Restore by copying it back.
