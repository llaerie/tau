# Company knowledge (Layer C) — the Finance Bible

`lib/knowledge/finance-bible.ts` is the single structured record of what the system knows
about the **real** company. It has exactly 30 sections (Entity profile, Ownership, Revenue
model, Customers, Employees, Contractors, International workforce, Bank accounts, Cards,
Payroll provider, Accounting system, CPA, Insurance, Chart of accounts, Recurring revenue,
Recurring expenses, Accounting policies, Expense policy, Reimbursement policy, Approval
matrix, Tax calendar, Payroll calendar, Month-end close checklist, Year-end checklist,
Document retention, Personal/business separation rules, Materiality thresholds, Cash reserve
policy, Budget assumptions, Forecast assumptions).

## Field statuses

| Status | Meaning |
|---|---|
| `CONFIRMED` | A fact the owner has stated (entity type, S election, California, worker counts, no accounting software, a CPA exists, revenue arrives in the company bank account). |
| `UNCONFIRMED` | Unknown. `value` is `null` — never zero, never a guess. A field may carry a `PROPOSED:` note with a working default (e.g. receipt threshold 75.00) but it is still unconfirmed. |
| `PROFESSIONAL_REVIEW_REQUIRED` | Needs a CPA / attorney / payroll professional: owner compensation, the related-party revenue payer, China worker classification, CPA responsibilities. |
| `SUPERSEDED` | A prior version kept for history after `applyConfigAnswer()`. |

## What is known about the real company (and nothing more)

- California LLC that elected S-corporation taxation; one owner; the owner's father does **not** own the LLC.
- AI-related services business; roughly $30,000/month arrives directly in the company bank account from a payer associated with the CEO's father (related-party flag, CPA review).
- 3 US-based and 2 China-based workers; a "~$8,000/month total employee allocation" whose basis (gross / net / contractor / employer cost) is **unknown**.
- No accounting software; payroll software unknown; a CPA exists but their responsibilities are unknown; bank accounts, cards and the invoicing process are unknown.
- Owner salary of $3,000 gross/month is a **proposed** assumption requiring professional review. $3,000 gross/month for the owner's fiancée for legitimate work is a configurable, **unconfirmed**, related-party assumption.
- Household / personal finances live in a separate system and are never accessible here.

## Secrets

The EIN and account numbers are never stored in the dataset. The bible holds only a
**vault reference id** (`entity_profile.ein_vault_reference`).

## "Complete the Finance Setup"

`unknownsRegistry(fields)` returns the 26 setup items, each with why it matters, who can answer
(role) and which capabilities it blocks. `blockedCapabilities(fields)` inverts that map.

## Synthetic lab company

`lib/knowledge/synthetic-profile.ts` builds the fictional **Northlight AI Services LLC**. Every
field is `synthetic: true`. It exists only so the lab can run end to end; it is never merged with
the real bible.
