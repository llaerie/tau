# Finance Desk — build checklist

Legend: `[ ]` todo · `[~]` in progress · `[x]` done and verified

## Stages 1–7 (first build and Will/Arielle plan)
- [x] Scaffold, engine, data layer, auth/modes, screens, assistant, verification, pushed

## Stage 8 — Assistant-first rebuild
- [x] Audit and migration plan (`docs/ASSISTANT_FIRST_PLAN.md`), skills vendored at project scope
- [x] Financial corrections: two $3k salaries only, $8k allocation archived, rent $5,800 + Teslas $1,200 paid by company for household, subscriptions itemised with tiers to confirm, API usage separate, hardware/furniture as dated one-time plans, no flat tax, withholding = FICA 7.65% + SDI 1.3% + income tax (unknown until entered), take-home verified only from pay stub/provider
- [x] Engines: payroll, cash plan with exact partial-remainder label, food plan, splits, ledger semantics; regression tests
- [x] Schema migration 0002 (additive), assumptions v3 with superseded archive and history, demo seed v3 (live never reseeded)
- [x] Design tokens light/dark/system, persisted per user; reduced motion
- [x] Five destinations, redirects from old routes, mobile bottom bar + profile menu
- [x] Assistant home: briefing, ≤3 attention items, starters, scope, streaming + Stop, preview mode with "Connect assistant"
- [x] Result components with "View calculation"; action cards draft → preview → approve → apply (idempotent, audited)
- [x] Money, Activity (search/filter/detail/split/void/record/CSV), Documents (upload, receipt review → expense), Settings
- [x] Push-to-talk with transcript preview and truthful fallbacks; optional spoken replies with Mute
- [x] Privacy enforced server-side; partner summary coarse and switchable; documents and chat per user
- [x] Tests: 78 unit (engines, action engine, privacy, preview router), e2e journeys A–K + themes + redirects + live mode, typecheck, lint, build
- [x] Visual sweep at 1440×900, 1024×768, 390×844, 360×800 in both themes (`docs/design-review.md`)
- [ ] Live Claude smoke test with a real key (not run in this session; adapter verified through the mocked preview path and typed SDK usage — see README checklist)
