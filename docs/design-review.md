# Design review — assistant-first rebuild

Date: 2026-09-11. Reviewed screens: Assistant home, Money (My money, Company, Household, partner
summary), Activity, Documents, Settings, receipt review drawer, purchase result. Both themes at
1440×900, 1024×768, 390×844 and 360×800 (screenshots taken with Playwright/Chromium and inspected
by eye; the checks below are what was actually looked at).

## Skills used, honestly

| Skill | How it was obtained | What was actually used |
|---|---|---|
| UI UX Pro Max (`nextlevelbuilder/ui-ux-pro-max-skill`, rev `7f69fed6…`, MIT) | Vendored at project scope under `.claude/skills/ui-ux-pro-max` (see `.claude/skills/VENDORED.md`). | The offline `scripts/search.py` was run for a "finance assistant dashboard" design-system query. Its suggestion (navy/gold, Lexend + Source Sans 3, Swiss minimalism) was read but **not adopted** for colour or type, because the specification fixes the palette (warm near-white / dark charcoal, one teal accent) and Inter was already loaded. Its accessibility and spacing guidance (tap targets ≥ 44px on mobile, one accent, semantic colour only for meaning, tabular figures) was followed. |
| Impeccable (`pbakaus/impeccable`, rev `cb56ed6c…`, Apache 2.0) | Vendored `SKILL.md`, `reference/` playbooks and `agents/` only. The launcher that downloads a detector binary and the auto-installed PostToolUse/Stop hooks were **not** vendored. | The craft-floor, operate, distill and layout playbooks were applied manually as a checklist (below). No automated Impeccable engine run happened; anyone wanting it can run `npx impeccable install --scope=project --providers=claude` and review the hook manifest first. |

No other design tooling was used. Nothing was fetched at runtime.

## Information hierarchy decisions

1. **Assistant first.** `/` is the assistant: greeting, at most three attention items with their
   consequence and one link each, one money line (take-home with its status caveat), the next
   fourteen days, then the conversation and a composer with three starters and a scope switch.
   No waterfall, no card grid, no hero-metric template on the home screen.
2. **Five destinations only.** Assistant, Money, Activity, Documents, Settings. Desktop: a
   compact 200px rail. Phones: a four-item bottom bar plus a profile menu (Settings, Appearance,
   Sign out). Old routes (`/company`, `/household`, `/personal/:id`, `/transactions`,
   `/accounts`, `/scenarios`, `/assistant`, `/overview`, `/more`, `/onboarding`) redirect.
3. **Money keeps spaces separate.** Tabs per space; nothing is netted across tabs. Each figure
   carries a "View calculation" control that opens a drawer with formula, inputs, sources,
   assumptions and caveats. The default surface stays short.
4. **Actions are previews until approved.** Every write from chat or from a page goes through the
   same draft → preview → approve → apply card, which states what it will not do.

## Craft checklist (from the Impeccable playbooks), with findings and fixes

| Check | Finding | Fix |
|---|---|---|
| No eyebrow label on every section | Early draft had `label` eyebrows on all cards | Kept eyebrows only where a card has no natural heading; Money statistics use plain sentence labels |
| No nested cards | Action cards inside result lists were double-bordered | Action/result cards are flat sections inside the conversation; drawers hold detail, not more cards |
| No identical card grids | Company tab originally rendered six equal metric tiles | Replaced by a two/three-column stat list with different emphasis and the exact partial-remainder label |
| Skeleton loading | Action card fetch showed nothing | Skeleton bars while an action loads; "Working…" pulse while a tool runs |
| All component states | Composer had no empty/denied/unsupported voice states | Voice: unsupported ("Voice unavailable here"), permission denied, provider error, listening with interim transcript. Assistant: preview, connected, error, stopped |
| Motion 150–250 ms, reduced motion | None | `fade-in` 200 ms, `slide-up` 220 ms, `prefers-reduced-motion` collapses all animation |
| Contrast | Dark-mode accent `#33d1bb` on `#1d2024` ≈ 8.9:1; light accent `#0e7a70` on white ≈ 5.6:1; body ink ≥ 12:1 both themes; `ink-3` secondary text ≈ 4.6:1 light / 5.0:1 dark | Kept; unknown-purple chips ≥ 4.5:1 on their soft backgrounds |
| Tap targets | Scope pills were 28 px tall | Buttons and inputs are 38 px; mobile nav items 52 px; small `btn-sm` (30 px) used only inside dense rows |
| Floating controls over navigation | Sticky composer overlapped the bottom bar on phones | Composer sits `bottom: safe-area + 4.25rem` on phones and `1rem` on desktop |
| Horizontal overflow | None found at 360 px after the sweep | Long labels wrap; tables scroll inside `table-wrap` |
| Dialog focus | Native `<dialog>` used for drawers | Escape closes, focus is trapped by the browser, close button is first in tab order |

## Theme tokens

Defined once in `src/app/globals.css` as `--t-*` custom properties on `:root` (light), overridden
under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`, and again for
`:root[data-theme="dark"]`, then exposed to Tailwind via `@theme inline`. Persisted per user in
`user_preferences.theme` and mirrored in the `fd_theme` cookie so the server renders the right
`data-theme` attribute without a flash.

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | `#f7f6f2` | `#15171a` | canvas |
| surface / 2 / 3 | `#fff` / `#f2f1ec` / `#e9e8e2` | `#1d2024` / `#23272c` / `#2c3137` | cards, hover, chips |
| ink / 2 / 3 | `#1b1e22` / `#4c535a` / `#7a828a` | `#ecedee` / `#b4b9bf` / `#878e96` | text hierarchy |
| accent / strong / soft / on-accent | `#0e7a70` / `#0b5f58` / `#dff1ee` / `#fff` | `#33d1bb` / `#6fe3d2` / `#163a36` / `#0f1b19` | the one accent |
| good / warn / bad / unknown | `#1f7a45` / `#9a5b06` / `#b3262a` / `#5d55b8` | `#55d38a` / `#f2b85e` / `#f27a7a` / `#aea4f5` | meaning only |

Reusable components: `AppShell`, `Drawer`, `ResultCard`, `ActionCard`, `Composer`,
`CalcButton`, `Money` (AmountText/TotalText/Cents), `ui` (PageHeader, Section, Card, Notice,
EmptyState).

## What was not done

- No automated visual-regression baseline; screenshots live in the session, not the repo.
- The Impeccable detector engine was not run (not vendored on purpose).
- Contrast figures above are computed from the hex values, not measured with an assistive tool.
