---
target: "Finance Desk app (assistant-first UI)"
date: 2026-09-11
total_score: 21
max_score: 40
na_heuristics: ""
p0_count: 1
p1_count: 4
method: "dual-agent (A: design review, B: browser measurement)"
detector: "unavailable - scripts/impeccable launcher not vendored"
---

# Critique: Finance Desk, assistant-first UI

Mode: Operate. Routes assessed: /, /money?space=me|company|household|partner, /activity, /documents, /settings.
Themes: light and dark. Viewports: 1440x900, 1024x768, 390x844, 360x800.

## Design health

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Approval card lands off-screen below the sticky composer; no aria-live on the answer or on the applied state |
| 2 | Match system / real world | 2 | "Partial cash-planning remainder before unlisted...", "Applying again changes nothing", Source: seed, times in UTC |
| 3 | User control and freedom | 2 | No undo after Approve and apply though the model has a reversed state; no way to start a new conversation |
| 4 | Consistency and standards | 2 | Two different "View calculation" controls and drawers; 33 type combinations; 25 spacing values across two parallel systems; four date formats |
| 5 | Error prevention | 3 | Strong: draft to preview to approve, void needs a reason, unknowns never coerced to zero. Disabled Preview never says which field is missing |
| 6 | Recognition rather than recall | 3 | Scope chips, starters and provenance are visible; briefing sends you to another page to hunt for the editor |
| 7 | Flexibility and efficiency | 1 | No keyboard shortcuts beyond Enter to send; no bulk actions; no month navigation; filtering needs a form submit |
| 8 | Aesthetic and minimalist design | 2 | Six co-equal hero numbers on Company with a ragged baseline; composer block eats 233px of 900 |
| 9 | Error recognition and recovery | 2 | Good failure copy, no inline field validation, no recovery from the needs-review dead end |
| 10 | Help and documentation | 2 | Plentiful inline caveats, no help entry point, no onboarding, and the assistant's calculation drawer has no calculation |
| **Total** | | **21/40** | Acceptable, low end. Significant work before these two users are happy |

## Design specificity

Split decision. The money semantics are authored and could not be lifted into another category: the unknown chip system, "known so far, N unknown", "Not profit, not a balance, not safe to spend", the before/after diff on an action preview, and the Money provenance drawer. Everything holding those parts is a stock SaaS kit: a 200px left rail with a lettered mark, a right-aligned user bubble with starter chips and a sticky rounded composer, Inter with one teal accent and a 12px radius.

The product's actual idea has no visual form. Four spaces (company, household, my private money, partner summary) render as an undifferentiated grey tab strip and three identical pill radios. Company money and Arielle's private money look pixel-identical. The privacy boundary, the most distinctive claim in the product, is carried entirely by 12.5px grey sentences in the lowest-contrast token in the system.

## Deterministic evidence

Detector unavailable (launcher not vendored). Browser measurement, 64 route/viewport/theme combinations.

| Finding | Measurement |
|---|---|
| Light-theme muted text contrast | 259 failing selectors; --t-ink-3 #7a828a is 3.90:1 on white, 3.60:1 on bg. Dark fails 1 |
| Accent chip contrast | #0e7a70 on accent-soft is 4.45:1, short of 4.5 |
| Control borders | --t-line-2 against its surround is 1.48-1.80:1 in both themes; needs 3:1 |
| Active nav / selected filter | distinguished by a 1.14-1.37:1 fill only |
| Tap targets under 44x44 at 390px | 82 controls |
| Tap targets under 24x24 at any size | 17 controls, including four 13x13 checkboxes |
| Composer textarea focus ring | none; outline-none defeats the global focus rule. 165 of 165 other stops pass |
| Drawer accessible name | none; the h2 title is not referenced |
| Drawer entrance animation | dead; open:slide-up compiles to no rule |
| Activity row truncation at 390px | ~100 clipped labels, worst at +382px |
| Money figures clipped | 0 of 338 |
| Type scale | 33 distinct size/leading/weight combinations, 13 sizes, 10 of them between 10.5 and 15px |
| Spacing scale | 25 distinct values, 14 off the 4px step, all high-traffic rem fractions from globals.css |
| Colour tokenisation | all 36 rendered values map to tokens, zero bypass |
| Horizontal overflow | 0 of 64 |
| prefers-reduced-motion | verified by re-measurement, all animation collapses |
| Heading outline | assistant home skips h1 to h3; six of eight routes expose no sub-headings at all |

## What is working

1. The known/unknown type system rendered as visual language. It propagates from the engine through Amount and Total into one consistent chip, so the user learns a single rule and it holds everywhere.
2. Provenance drawers on Money. Formula, inputs, caveats, with the value restated on top. It answers the three questions a suspicious person actually has, in that order.
3. Draft to preview to approve with a real before/after diff. The preview shows the consequence, not just the input, so the user approves an outcome.

## Priority issues

**[P0] The sticky composer hides the approval card.** The composer block is 233px of a 900px desktop viewport and about 420px of an 844px phone viewport. The scroll anchor uses a hardcoded 16rem margin that is smaller than the real block. After asking for a budget change on desktop the card is sliced and Approve and apply is off-screen. On a phone the whole card is below the composer. Fix: measure the block with a ResizeObserver, scroll the action card's button row into view, collapse the mobile footer to one line, and dock a "1 change waiting for approval" bar above the composer.

**[P1] "View calculation" in the assistant shows no calculation.** It opens a drawer with assumptions and caveats, no rows, no arithmetic, then 600px of white. The identically labelled control on Money shows formula, inputs and caveats with real numbers. Fix: feed the assistant's result components the same provenance payload, or suppress the button when rows is empty.

**[P1] The muted text token fails AA in light mode and carries every reassurance.** It is used for all eyebrows, card explanations, "Nothing was saved" states, and both privacy notes. Fix: raise light ink-3 to about #5f676e, darken the accent used in chips, lift the minimum size for that token to 12.5px.

**[P1] No undo after Approve and apply.** The action model already has a reversed state with no UI. The safety story is "nothing happens until you approve"; the corollary users expect is "and I can take it back". Fix: a Reverse this change control on applied cards, with the same preview-then-confirm treatment.

**[P1] The needs-review loop dead-ends.** Company says two payments need tax-treatment review and links to Activity. The only actions there are Split and Void. Fix: add a drafted set_treatment action to the transaction drawer and link the notice to a filtered review queue.

## Persona red flags

**Alex, power user.** No shortcut focuses the composer, opens Money, or approves a pending action. Four subscriptions each need their own expansion. No month navigation anywhere. Activity filtering needs a Filter button press.

**Sam, accessibility-dependent.** Light muted text at 3.6 to 3.9:1. No aria-live on the answer or the applied state, so a screen reader gets silence at both moments that matter. No skip link. Approve is 135x30 on mobile. Push-to-talk is a hold gesture whose keyboard fallback requires holding Space.

**Casey, distracted mobile.** With the keyboard open the composer and disclaimer fill the viewport. Returning with history auto-scrolls to 7,749px, so the briefing is never seen again. Up to 40 turns re-mount at once, each action card firing its own fetch.

**Will, owner-operator.** His question has no answer element: Company opens with six co-equal 26px numbers and none of them is the answer. The one closest to "what can we afford" is labelled with thirteen words that wrap to three lines and knock its baseline 37px below its neighbours. The assistant home tells him nothing about the company.

**Arielle, creative director.** Her question returns a refusal with no floor. The fastest receipt path is four screens and six fields including a 14-item category select, with no camera affordance. Documents defaults the owning space to the company for her personal receipt.

## Minor observations

Record expense renders inside the page header's actions slot and inflates it, crushing the heading into a narrow column. Placeholders are used as values, so a stored unknown is indistinguishable from an empty field. Every action card prints a hardcoded "Will not:" prefix in front of already-complete sentences, with a doubled period. Rows whose before and after are both unknown render as struck-through unknown followed by unknown. Developer fields leak into the transaction drawer. The success line reads "Applying again changes nothing" and stamps the time in UTC in a product that cites California tax rates. The briefing repeats an upcoming item and uses a fourth date format.

## Questions to consider

1. If the assistant is the product, why does the food question return six rows of equal weight instead of one number and its confidence band?
2. The engine refuses an exact figure because withholding is unconfirmed, but a floor is computable. Is refusing to guess the same as refusing to bound?
3. What if every unknown chip were itself the fix, rather than a label naming a chore on another page?
4. Will and Arielle share a shell but share almost no job. What breaks if their home screens diverge?
5. The privacy boundary is the most distinctive thing here and has no visual form. What would it look like if you could see the wall?
6. If nothing is saved until approval, why does Approve look like every other secondary button and sit off-screen?
