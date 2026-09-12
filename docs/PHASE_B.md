# Phase B — the identity applied to the remaining screens

Phase A established the shell, the Assistant surface and My money against
`finance-desk-redesign/DESIGN_BRIEF.md`. Phase B extends the same identity to
Company, Household, Arielle's summary, Activity, Documents and Settings.

Brief §15 governs this phase: the second pass must not revert to repeated cards
and long default tables. Dense accounting material belongs behind a disclosure
or in a dedicated report view; the normal experience stays assistant-led.

## Run it

```bash
cd ~/tau
pnpm install
pnpm build
pnpm start:demo      # http://localhost:3000, synthetic demo data
```

Sign in as Will or Arielle from the persona buttons. Demo mode is labelled in
the sidebar and on every money screen; no real balances are involved.

## What changed

### Shared composition — `src/components/money/Panels.tsx`

One set of parts now carries every money screen, so Company, Household and
My money read as the same product rather than three card walls:

- `FeaturePanel` — the one figure a screen is about, with its caption, its
  evidence link and an optional "still unknown" callout.
- `SupportRow` — up to three supporting figures on one band beneath it.
- `Disclosure` — everything an accountant wants and a Saturday morning does not.
- `UnknownCallout` — what is missing, and the control that fixes it.
- `ListRow` — a bill, a subscription or a planned purchase as a quiet row.

### Company

Recorded cash is the hero, with runway on known costs beside it. Expected
receipts, received-so-far and known commitments sit on the support row. The
partial cash-planning remainder keeps its own panel and its verbatim label —
it is not profit, not a balance, and not safe to spend. Subscriptions and
planned purchases are lists, not tables. The projection and the account
breakdown are behind a disclosure.

### Household

Company-paid household spending is the hero, captioned with payer, beneficiary
and tax treatment so the three never blur. Joint cash, own bills and planned
distribution support it. Bills the company pays and bills the joint account
pays stay two separate lists, because they are two different economic facts.

### Arielle's summary

Unchanged in substance: approved aggregates only. No merchants, dates,
categories or amounts, and no private rows fetched and hidden in markup.

### Activity

- Rows group under day headings inside one card, rather than one card per day.
- The filter bar applies on change. There is no submit button: the space pills
  and month apply immediately, search debounces at 250 ms, and a "Clear
  filters" control appears once anything is narrowed.
- The review queue is surfaced as a banner above the filters with a direct link,
  and the review filter is a toggle chip carrying its own count.
- CSV import moved into a disclosure, with the warning that imported rows are
  unreviewed and count nowhere until a purpose and treatment are given.
- Void, split and CSV import behave exactly as before.

### Documents

- Files split into "Waiting for you" and "Recorded", because a stored receipt
  that is not an expense is work, and one that is, is history.
- A banner counts files not recorded yet and says plainly that storing a receipt
  changes nothing on its own.
- The detail drawer uses the evidence-drawer treatment: "What the file says",
  each parsed field on its own inset row, and a line saying the figures were
  read from the file's own text and should be checked.
- The record-from-receipt flow, its preview and its approval are untouched.

### Settings

Settings was one 3,330 px scroll with tax workpapers in the same column as the
theme picker. It is now grouped, with in-page navigation:

| Group | Holds |
| --- | --- |
| You | Profile, the partner-summary switch, appearance |
| Assistant | Model connectivity and spoken replies |
| Payroll | Gross pay and withholding per person |
| Company | Company, tax and budget assumptions |
| People | Members, per-space roles, invite links |
| Data & export | Integrations, JSON export, demo reset |
| **Advanced** — Plan review | Open review items, superseded assumptions, goal/budget records |

Each group is deep-linkable (`/settings#payroll`) and the advanced group is
listed apart from the everyday ones. The theme picker is now the same segmented
control used in the composer, and the two preference switches are real toggles.

## A bug found while reviewing the rendered pages

The Documents drawer shows what was parsed from a receipt, which put the
extractor's output in front of the user at full size for the first time. A
receipt reading `Total $1,399.00` was being parsed as **$1.39** — the old regex
`(\d{1,5}(?:[.,]\d{2}))` matched `1,39` and treated the thousands comma as a
decimal point. That wrong figure then pre-filled the record-expense amount.

`parseAmountCents` in `src/lib/documents.ts` replaces it. A separator is the
decimal point only when exactly two digits follow it, so `1,399.00`, `1.399,00`
and `1,399` all read as $1,399.00 while `12,50` still reads as $12.50. Anything
that is not a plain grouped number returns null rather than a number that
happened to parse. Seven new unit tests cover it in `src/lib/documents.test.ts`.

## Screenshots

`docs/screenshots/phase-b/` — 60 renders, captured from the running app at
1440×900 and 390×844 in both light and dark:

- `*-assistant`, `*-money-{personal,company,household,partner}`
- `*-activity`, `*-activity-review`
- `*-documents`, `*-documents-populated`, `desktop-light-documents-review-drawer`
- `*-settings-{you,payroll,company,people,plan-review}`
- `desktop-arielle-light-*` — the same screens as Arielle, showing the
  privacy-scoped view

## Second visual pass — what the renders caught and what was fixed

1. **One card per day in Activity.** Grouping put every day in its own card, so
   72 entries became roughly 40 cards — exactly the repeated-card failure §15
   warns about. Rebuilt as one card with day bands.
2. **Filter pills wrapping badly at 390 px.** "All visible" and "My money" broke
   across two lines. The pill group now scrolls horizontally on its own and the
   month select and review chip wrap to their own row.
3. **217 px horizontal overflow on Settings → People at 390 px.** The members
   table's `overflow-x: auto` could not take effect because its grid ancestors
   defaulted to `min-width: auto`. Fixed with explicit `minmax(0, 1fr)` columns
   and `min-w-0` on the tab panel.
4. **Settings tabs 350 px wide each on mobile.** `w-full` was applying at every
   width; it is now `min-[900px]:w-full`.
5. **Upload form unreachable once you had documents.** The disclosure defaulted
   closed whenever the list was non-empty, hiding the page's primary action. It
   now defaults open.
6. **No visual separation for the advanced group on mobile**, where the
   "Advanced" label is hidden. A divider now precedes it in the scrolling rail.

## Tests actually run

| Check | Result |
| --- | --- |
| `pnpm test` | 86 passed, 18 files |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm build` | compiled successfully |
| `pnpm test:e2e` | 28 passed, 2 skipped, 0 failed |

Two e2e assertions were retargeted rather than weakened:

- `resetDemo` now navigates to `/settings#data`, because the demo-reset control
  lives in the Data & export group.
- The live-mode test asserted "Two Teslas" and "$5,800" inside
  `household-company-paid`, which is now the hero panel; the bill list moved to
  `household-company-bills`. The test asserts both: the names and amounts are
  still itemised in the list, and the hero still names what it is measuring.

## Limitations at this checkpoint

- **No model is connected.** The assistant runs in preview mode with fixed
  wording, labelled as such on screen. Nothing in this phase changed that.
- **The demo database was reset and reseeded** after the e2e run left test
  receipts in it (`pnpm db:reset && pnpm db:seed`). This is the synthetic demo
  workspace only. No live workspace was touched.
- **Documents is empty in the seed**, so the populated screenshots were produced
  by uploading a text receipt in a throwaway browser session, the same way the
  e2e suite does. The demo database was reset afterwards.
- **The reference images arrived as conversation attachments**, not as files at
  the paths the brief names. `docs/REFERENCE_NOTES.md` records what was read
  from them and that limitation.
- **Advanced reports are grouped, not built.** Brief §15 mentions dedicated
  report views for dense accounting tables. Plan review is where that material
  now lives; a full workpaper view is not in this checkpoint.
- **No deployment, no invitations sent, no payments, no access controls
  weakened.** Invite links can be created in demo mode but registration stays
  disabled there, as before.
