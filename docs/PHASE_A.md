# Phase A checkpoint: reference-led visual rebuild

Working frontend, not a proposal. Stops here for visual approval before the look
reaches Company, Household, Activity, Documents and Settings.

## Start it

```bash
pnpm install
pnpm build && pnpm start:demo     # http://localhost:3000, synthetic data
# or with hot reload:
pnpm demo
```

Sign in as **Arielle** for the incomplete fixture (no food target, withholding
unconfirmed) or **Will** for the configured one (food target $900, withholding
estimated). Both fixtures already existed in the demo seed; nothing was reseeded
and no live workspace is touched.

## What is in this checkpoint

| Area | State |
|---|---|
| Token system | Rebuilt from `finance-desk-redesign/tokens.css` as one blue identity across light and dark. The older `--t-*` names are aliased onto `--fd-*`, so pages not yet converted inherit the identity instead of drifting to a second palette |
| App shell | 208px labelled sidebar (Assistant, Money, Activity, Documents), settings and identity grouped at the bottom, 60-68px header carrying page, date and profile. Mobile: compact header, four labelled bottom destinations, settings in the profile menu |
| Assistant home | Greeting, brief, one next step, three contextual starters and the composer, all above the fold. Context rail at 1180px and wider; below that it moves under the composer so it never pushes it down |
| Assistant states | Ready, setup needed, model not connected, working. Composer docks when a conversation starts and keeps its draft |
| My money | One plan panel with an explicitly named principal figure, take-home in a disclosure, food target/spent/remaining with a direct adjustment, editable allocations, recent activity, and cash/bills/upcoming as lower-priority detail |
| Evidence drawer | Formula, inputs with sources, as-of, assumptions, caveats. Reached from the plan panel and from any assistant result |
| Receipt review | Inside the assistant: amount, payer, purpose, split shares and what the action will and will not do, with one approval |
| Action preview | Before and after, the affected plan, the boundaries, one approve action wired to the existing idempotent apply |
| Purchase result | Evaluated as a scenario with timing and missing inputs. Never a payment |
| Appearance | System, light and dark from the profile menu. Persists per user and switches without losing state |

## Outside this checkpoint

Company, Household, Activity, Documents and Settings still render their previous
layouts. They are fully usable and inherit the new tokens, so they read as the same
product, but their composition has not been redesigned. That is Phase B.

## Screenshots

All under `docs/screenshots/phase-a/`, captured from the running app.

| File | Viewport, theme |
|---|---|
| `assistant-desktop-light.png` | 1440x900 light, incomplete fixture |
| `assistant-desktop-dark.png` | 1440x900 dark, configured fixture |
| `assistant-mobile-light.png` | 390x844 light |
| `assistant-mobile-dark.png` | 390x844 dark |
| `my-money-desktop-light-complete.png` | 1440x900 light, configured |
| `my-money-desktop-dark-complete.png` | 1440x900 dark, configured |
| `my-money-mobile-light-incomplete.png` | 390x844 light, incomplete |
| `my-money-mobile-dark-incomplete.png` | 390x844 dark, incomplete |
| `conversation-active-desktop-light.png` | active conversation |
| `action-preview-desktop-light.png` | budget change awaiting approval |
| `receipt-review-desktop-light.png` | receipt with split shares |
| `receipt-review-mobile-dark.png` | same on a phone |
| `purchase-result-desktop-dark.png` | purchase evaluated as a scenario |
| `evidence-drawer-desktop-light.png` | evidence drawer open |
| `assistant-w1024-dark.png` | 1024x768, rail collapsed |
| `assistant-w360-light.png` | 360x800 |

## Second visual pass

The first renders were inspected and these defects were fixed, not just noted:

- The composer sat at the bottom of a tall column on desktop, leaving a void between
  the starters and the input. It now sits directly beneath the starters.
- The composer fell below the fold on a phone by about 400px, because the context rail
  was rendered above it. The rail moved below the composer.
- My money overflowed horizontally by 217px at 390px, because a single-column grid was
  sizing to content. Constrained with `minmax(0, …)` and `min-w-0`.
- An action card's approve row was hidden behind the docked composer, on desktop by
  134px and on a phone by 295px. A ResizeObserver now publishes the dock's real height
  and the card scrolls its own approve row clear of it. `scroll-margin-bottom` was not
  honoured reliably here, so the offset is computed.
- The boundary block rendered "This will not Records one economic expense", because a
  prefix was being forced onto sentences that are already complete and vary in phrasing.
  The engine's sentences are now listed as written.
- "Two Teslas" appeared twice in Up next: one obligation was reachable from two
  directions. Deduplicated in `upcomingObligations`.
- The rail figure read "$2,732 before income tax" as one string. The figure and its
  qualification are now separate.
- The sidebar truncated the signed-in name to "Ari…". Restructured.
- The incomplete-state callout squeezed its sentence into a narrow column on a phone.
  It now stacks.

## Tests actually run

| Command | Result |
|---|---|
| `pnpm test` | 79 passed, 17 files. Financial engines, action-engine idempotency, authorization and privacy, preview router |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm build` | clean |
| `pnpm test:e2e` | 28 passed, 2 skipped. Journeys A to K, themes, redirects, privacy, live mode |

The two skipped tests are the live-mode server tests on the mobile project; they are
viewport-independent and skip by design.

Seven e2e assertions were updated because the redesign moved or reworded what they
targeted. None was weakened: the take-home floor assertion now reads the context rail
where that figure lives, and the assertion that setting a food target does not invent
an unallocated figure was made stronger, not softer.

Additionally verified in the browser, not asserted from code: keyboard reach to the
composer with a visible focus ring within 30 tabs; no horizontal overflow at 200% text
size; theme switch preserving composer draft text; `prefers-reduced-motion` collapsing
every animation, re-measured rather than read from the stylesheet.

## Limitations

- **No model is connected.** Everything runs in preview mode: the same server-side
  tools, fixed wording, labelled as previews. The streaming, cancellation and retry
  paths exist but were not exercised against a live model in this session. To test:
  set `ANTHROPIC_API_KEY` on the server, restart, and confirm the status line reads
  "Claude connected".
- **Preview answers are long.** The purchase result opens with a paragraph of
  qualification before its conclusion. Every sentence is load-bearing, so it was not
  trimmed; restructuring conclusion-first belongs with the model adapter work.
- **Voice** was feature-detected in headless Chromium but not exercised with a real
  microphone or speech synthesis voice.
- **Contrast** was checked against the supplied tokens by computation, not with an
  assistive tool. The muted token measures 5.44:1 on white and 7.02:1 on the dark
  canvas.
- The reference and before images were supplied as conversation attachments, not as
  files at the paths the brief names. See `docs/REFERENCE_NOTES.md`.

## Design critique against the references

What carried over: depth from stacked surfaces rather than borders, one saturated
accent reserved for the next useful action, a figure-to-label ratio that actually
reads, and an assistant that is the page rather than a widget on it.

What deliberately did not: the acid-green second identity, card numbers, APY offers,
promotional banking controls, phone mockup frames, and the reference's inconsistent
number formatting.

Where this still falls short of the references: their screens carry six elements each
and ours carry real ledgers, unknown states and audit trails, so the density is higher
by necessity. The assistant home is the closest to the reference standard; My money is
denser than either reference would allow, and Activity will be the hardest surface in
Phase B.
