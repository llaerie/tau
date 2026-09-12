# Finance Desk - Reference-Led Visual Rebuild

## Read this first

You are implementing a new visual and interaction direction in the EXISTING Finance Desk application. You are not rebuilding its accounting architecture, training an AI CFO, changing its tax rules, or starting another disconnected demo.

The user rejected the existing interface and supplied two visual references. The previous implementation is too flat, repetitive, text-heavy, and difficult to use. The goal is an assistant-led finance product with a deliberate, premium visual identity.

This brief replaces earlier AESTHETIC instructions, including the restrained teal palette, blanket gradient avoidance, flat cards, and blanket rejection of an assistant emblem. It does NOT replace financial correctness, authorization, privacy, provenance, approval, or data-preservation requirements.

Build PHASE A below now. This means real running frontend code, not a verbal proposal. Stop at the explicit visual-approval checkpoint before extending the look to the rest of the product.

## 1. Files to inspect before coding

Open and visually inspect these files, relative to this brief:

- `references/light-fintech.png`: user-supplied blue/white mobile finance reference.
- `references/dark-assistant.png`: user-supplied charcoal/green finance-assistant reference.
- `before/previous-assistant.png`: the old assistant presentation to improve upon.
- `before/previous-money.png`: the old worksheet-like money presentation.
- `tokens.css`: authored starting tokens for this design direction.

These images are private reference material, not product assets. Do not ship screenshots, logos, sample balances, phone frames, branding, cryptocurrency features, referral offers, or illustrations from them in the application. Do not reproduce a reference screen pixel-for-pixel.

Write a short note with five concrete visual observations from the actual images. Do not claim to have inspected images if the environment cannot open them. When image access is unavailable, record that limitation and follow the written art direction rather than fabricating image observations.

Inspect the repository, its instructions, package manager, installed libraries, routes, permissions, financial adapters, tests, working tree, and current screenshots. Preserve uncommitted work. Use a feature branch when safely available; never reset or force-push an existing branch. Do not assume the historical branch `claude/finance-desk-app-f6yoqf` is current.

## 2. Art direction: luminous blue, sculpted surfaces, quiet intelligence

Create one cohesive identity with two themes.

From the LIGHT reference, adopt:
- a controlled blue-to-ice-blue atmospheric accent;
- layered white surfaces with visible but restrained depth;
- comfortable curved corners and rounded action controls;
- dominant financial typography paired with small, clear labels;
- compact, thumb-friendly groups of actions.

From the DARK reference, adopt:
- near-black/charcoal materials rather than an inverted white template;
- compact, purposeful information density;
- an assistant that feels present and central;
- clear separation between background, working surfaces, and overlays;
- a distinctive accent used for the next useful action.

For Finance Desk, use BLUE across both themes. Do not give light mode a blue brand and dark mode an unrelated neon-green brand. Green remains a semantic status where appropriate, not a second competing identity.

The desired character is precise, approachable, tactile, and technically capable. Not a crypto wallet, gaming HUD, corporate accounting portal, or decorative marketing website.

Premium here means intentional proportions, contrast, surface depth, typesetting, composition, and interaction. It does not mean adding shadows and gradients to every existing rectangle.

## 3. The product hierarchy

The opening screen must answer: "What can my finance assistant help me do right now?"

Primary experience:

OPEN -> READ A SHORT USEFUL BRIEF -> ASK OR ACT -> REVIEW A CLEAR RESULT -> OPEN DETAILS ONLY WHEN NEEDED.

One primary home: Assistant. Do not keep an Overview page competing with it.

Desktop navigation: Assistant, Money, Activity, Documents. Put Settings, profile, appearance, and integrations together at the bottom of the sidebar or in the profile menu.

Money uses contextual tabs: Company, Household, My money. A partner summary must expose only approved aggregates. Do not flatten the company and both people into a single combined spending balance.

Keep accounting reports, tax workpapers, audit logs, and any CFO Academy inside an advanced area. None belongs in the daily first-screen navigation.

## 4. Concrete desktop composition

At approximately 1440 x 900:

- Use a 196-216 px labeled sidebar, not a 250 px sidebar plus another empty 200 px gutter.
- Use a 64-72 px top header and 28-40 px content padding.
- Main working region: flexible assistant column, with a secondary context column approximately 290-320 px wide where space permits.
- A 24 px grid gap is a starting point, not a reason to crush content.
- Keep readable conversation content near 680-760 px in width. Do not stretch prose from edge to edge on a large monitor.
- Collapse the context column below roughly 1180 px; do not squeeze everything into three narrow columns.

The hierarchy should be recognizably different from the rejected implementation:

[compact navigation] [context / date / theme / profile]
                     [assistant greeting and short useful briefing] [context]
                     [three contextual action starters]             [up next]
                     [conversation or active result]
                     [prominent composer]

The assistant area should feel integrated into the application canvas, not like a small messenger iframe inside a white box. A single inset conversation/result surface is acceptable. Avoid the old large border around a mostly empty chat transcript.

In the initial state, place the composer directly beneath the brief/starters in the main working area, visible without scrolling. When conversation begins, collapse the greeting and dock the composer naturally at the bottom of the conversation region. Preserve draft text and scroll position during this transition.

Use a compact original assistant emblem, about 48-64 px on desktop, with layered blue light or a restrained ring. It is a recognizable presence, not a giant spinning orb. Do not build a 300 px empty visual centerpiece.

The right context rail contains ONE relevant money summary and up to three upcoming or review items. Do not repeat the same cash amount in five cards. Do not add a chart merely to fill empty space.

## 5. Concrete mobile composition

At 390 x 844 and 360 x 800:

- Compact header: Finance Desk identity, context selector, avatar/profile.
- Four labeled bottom destinations: Assistant, Money, Activity, Documents.
- Settings stays in the profile menu.
- Content gutters approximately 20 px, shrinking thoughtfully for the narrowest screens.
- The assistant greeting, a short useful brief, an immediate action, and the composer must appear without a long scroll.
- No horizontally clipped rows of suggestion cards. Wrap short chips or show a clear vertical action list.
- Use a subtle floating bottom bar with adequate safe-area padding, not a giant 100 px rounded slab.
- Keep composer above the bottom bar when idle; handle mobile keyboard appearance without overlap or two fixed controls fighting for the same space.
- Prefer normal flow where possible, modern viewport sizing, and browser-tested keyboard behavior. Do not rely on a fixed `100vh` composition that obscures inputs.
- Use full-height or appropriately sized sheets for receipt review, source details, and scenario work; accessible labels, close controls, and focus restoration are required.
- Permit scrolling and text reflow. Do not reduce font sizes to force a screenshot composition.

Do not put the real application inside an iPhone mockup. The references use device frames for presentation; our deliverable is responsive app code.

## 6. Typography, spacing, surfaces, and color

Use `tokens.css` as the explicit starting system, mapped into the existing application rather than imported blindly over unrelated global styles.

Typography:
- Use one appropriately licensed sans-serif family already available where possible: Geist, Inter, or an equivalent system stack. Do not download or redistribute proprietary font files.
- Body: 15-16 px, approximately 1.5 line height.
- Compact labels: 12-13 px, with genuine readable contrast.
- Section titles: 18-20 px, medium/semibold.
- Greeting: approximately 34-40 px desktop and 28-32 px mobile.
- Key financial figure: approximately 42-48 px desktop and 34-40 px mobile.
- Use tabular lining numerals for monetary comparisons, not monospaced typography everywhere.
- Keep currency, value, scope, date, and estimate status coherent. Use proper currency formatting; never imitate the inconsistent sample number formatting in the reference.

Surfaces:
- Light: cool pearl canvas, white raised panels, subtle blue-gray inset surfaces.
- Dark: carbon canvas, graphite working surfaces, slightly lighter overlays.
- Feature-panel radius around 24 px; secondary cards 18 px; fields around 14 px; pills only for appropriate short controls.
- Use one soft outside shadow and a faint inset highlight on important surfaces. Other sections can be borderless.
- Reserve a controlled gradient for the assistant atmosphere, a selected money panel, or the primary action. Do not place every paragraph over gradients.
- Support the full design in reduced-transparency/high-contrast conditions with a solid background fallback.

Blue action gradients are permitted. Pale ice-blue is decorative; normal white text must not disappear against a pale gradient stop. Verify contrast over the actual rendered background, not only against one token.

Keep success, warning, and error distinct from the brand. An attractive blue card is not evidence that a purchase is affordable. Unknown amounts never become green confirmations.

## 7. Assistant states and result components

Design the following real states, not only the empty greeting:

### A. Ready, with known data
A concise personalized brief from the permitted data, one relevant next action, and contextual suggestions. Use the actual authenticated name. No hard-coded "everything looks good" text.

### B. Setup needed
Example tone: "Let's finish your money plan." Then one specific missing input and a clear action. Show essential uncertainty next to the affected result. Detailed assumptions stay one click away.

### C. Model not connected
A compact, honest status and Connect assistant action. Deterministic previews remain explicitly labeled. Do not pretend a generated briefing or transcript came from a model.

### D. Working / listening / transcribing
Use the same assistant emblem and a plain-language status. Animation should respond to the actual state and stop when idle. Do not show a fake tool step or pretend the system is monitoring finances in the background.

### E. Answer
Short conclusion first, then at most a few relevant numbers in a purposeful result component, then a next action. Sources and assumptions open an evidence drawer. Critical qualifications remain visible next to the conclusion.

### F. Action preview
Before/after, affected account or budget, amount, purpose, and one approval action. Keep server-side authorization, idempotency, and audit behavior. A pretty success animation must only appear after a confirmed successful write.

Create reusable components such as AssistantPresence, Briefing, MoneySummary, Composer, ActionStarter, EvidenceDrawer, PurchaseResult, ReceiptReview, BudgetChangePreview, and StatusLabel. Adapt names to project conventions.

Do not wrap every sentence, heading, or tool call in another card. The assistant should feel like an intelligent workspace, not a wall of chat bubbles or status badges.

## 8. My money: the second screen to prove the design

My money is the first supporting page in Phase A because it tests the design with real information, not just an attractive empty assistant.

Composition:
- One prominent monthly-plan panel for the selected person.
- The principal figure is explicitly labeled (for example, unallocated monthly plan), not ambiguously "balance" or "spendable".
- Gross pay and verified/estimated take-home appear in an expandable breakdown, not as equally dominant competing cards.
- Food has a clear target / spent / remaining presentation and a direct adjustment action.
- Optional savings, investing contributions, shopping, and personal allocations are editable without imposing the obsolete plan.
- A small recent-activity list with date, merchant, amount, and status.
- Account cash, bills, and the full calculation remain available in a drawer or lower-priority detail area.

When required inputs are unknown, show the next useful setup action rather than a fictitious precise amount. Build a well-composed fully configured synthetic fixture AND an incomplete fixture so the design is tested in both situations.

One layered money panel can borrow the reference's physical sense of depth. Do not manufacture bank cards, APY offers, financial product features, card numbers, or a Send money action merely because they appear in the reference.

## 9. Keep the financial facts stable

These are user-supplied planning facts, not proof of cash or approved accounting treatment:

- Will: CEO and sole shareholder.
- Arielle: Creative Director, employee, not a shareholder.
- USD 30,000/month anticipated service payments to the company.
- USD 3,000/month GROSS proposed salary each, not net cash.
- No other workers in the current forward payroll plan; preserve genuine history and unpaid obligations.
- Rent: USD 5,800/month. Combined Tesla payment: USD 1,200/month.
- Old USD 8,000 allocation is retired; technology, software, and furniture are itemized instead.
- Two planned Claude subscriptions and two planned ChatGPT subscriptions; actual tiers/prices still require selection or billing evidence.
- App API usage is its own line item, not silently included in consumer subscriptions.
- Hardware and furnishing purchases are one-time plans unless explicitly configured otherwise.
- Food comes from each person's NET salary; remaining money can be allocated personally.
- No automatic USD 1,000 friends-travel requirement and no imposed old personal category amounts.
- No unsupported flat USD 5,000 monthly tax default; unknown taxes do not become zero.
- Company payment source is separate from expense purpose, beneficiary, and accountant-reviewed treatment.
- No fictitious combined company/household/personal cash balance.

Retain deterministic calculation engines, correct transfer/card/payment behavior, source links, privacy, and approval rules. Discover a defect? Isolate it, explain it, test it, and make only the correction required for the slice. Do not take this visual task as permission to replace the ledger or invent a tax calculation.

Preserve shared company/household views and private individual purchases, receipts, and personal chats. Partner summaries expose only approved aggregates. Never fetch unauthorized private rows and merely hide them in the UI.

## 10. Interaction requirements

Phase A should prove these paths:

1. Open Assistant, switch allowed context, and receive an accurately scoped brief or truthful setup state.
2. Ask about food spending and open the underlying calculation.
3. Enter "Set my food budget to $1,200" as a TEST action: show a preview, approve once, persist once. It is not a default budget.
4. Upload a receipt or exercise an explicitly marked fixture. Review payer, purpose, split, and amount without leaving the assistant.
5. Evaluate a one-time purchase as a scenario, not a payment. Show timing, missing inputs, and the effect on the relevant plan.
6. Switch light/dark/system appearance without losing state.
7. Open My money and adjust its plan through the same validated action flow.

Reuse actual model and action adapters where present. Without credentials, keep honest test/preview states. Do not call mock responses a connected AI.

Text chat is always available. Style and preserve push-to-talk and optional spoken replies where already supported. Missing provider support should produce an explicit limitation and text fallback, not a decorative microphone. No background recording, automatic spoken private balances, or financial actions based only on unreviewed audio.

## 11. Code and component standards

Preserve the existing stack and working server integrations. Do not add a second router, state store, styling system, or component library without a concrete need.

Use semantic tokens, not many unrelated hard-coded color values. Reuse accessible primitives for menus, dialogs, tabs, and tooltips; restyle them so the app does not resemble an untouched component demo.

Navigation and controls must have real destinations or clear disabled/setup behavior. No dead buttons. Do not imply account synchronization, saved records, or provider connectivity without evidence.

Use responsive layout instead of screenshot-positioned coordinates. Keep critical financial text as selectable accessible text, not part of a rendered image. Use CSS or a small original SVG for decorative presence; do not introduce a heavy WebGL scene for a finance screen.

Animations: mostly 140-220 ms hover/focus/press transitions, 200-280 ms overlays, minimal purposeful presence motion. Honor reduced motion. No constant number counting, scroll-jacking, auto-playing sound, or fake live tickers.

Accessibility acceptance target: WCAG 2.2 AA. Aim for at least 44 px touch hit areas. Verify keyboard-only operation, visible focus, adequate text/non-text contrast, zoom/reflow, labels, dialog behavior, announced statuses, and reduced motion. Never claim conformance merely because a palette exists.

Read installed UI UX Pro Max and Impeccable instructions when present. Do not invent command names or claim skills ran when unavailable. Do not install unreviewed remote scripts or let a skill override the visual references, security, or financial rules. Report actual skill usage briefly; skill names are not evidence of design quality.

## 12. Phase A: working visual checkpoint - do this now

Implement only the proof needed to establish the direction:

- token system and app shell;
- Assistant home in idle, active, incomplete, and provider-unavailable states;
- My money screen;
- evidence drawer;
- one receipt review flow;
- one purchase result/action preview;
- light/dark/system behavior and responsive layout;
- integration with existing calculations and approvals where available.

Use a preview route or flag if needed to keep production routes stable. Existing unconverted pages must remain usable and be clearly listed as outside this checkpoint. Do not fill them with fake redesigned controls.

Use isolated, consistent synthetic fixtures for visual checks. Label the demo. Never reseed a live workspace, silently replace real balances, or change saved personal choices.

Deliver working frontend code and browser screenshots, then STOP FOR VISUAL APPROVAL. This checkpoint is intentional. Do not redesign every page before the user has seen the direction. Do not stop before implementing the checkpoint itself.

## 13. Mandatory rendered review

Run the application and inspect the actual rendered result, not just code and screenshot filenames.

Capture:
- Assistant, desktop 1440 x 900, light and dark;
- Assistant, mobile 390 x 844, light and dark;
- My money, desktop and mobile, both themes;
- active conversation and one review sheet;
- incomplete-data and model-unavailable states.

Additionally test 360 px width, 1024 px width, keyboard navigation, mobile input focus, and enlarged text/zoom. Include any browser limitations honestly.

Compare the renders to the REFERENCES for hierarchy, depth, compactness, typography, and assistant emphasis, not pixel similarity. Compare to BEFORE images to ensure this is structurally more than a theme recolor.

Make a second visual pass after viewing the first renders. Fix at least the observed hierarchy/spacing/contrast/overflow defects; do not invent defects or report an iteration you did not perform.

Ask during the review:
- Is it immediately obvious that the assistant is the primary interface?
- Is the composer visible and approachable without scrolling a report?
- Does the first screen have one visual focal point, rather than eight equal panels?
- Is there controlled depth in both themes?
- Are important labels readable without tiny gray text?
- Does the mobile version feel designed, not merely compressed?
- Can an incomplete workspace still perform useful tasks?
- Are estimates and privacy boundaries apparent without dominating the screen?
- Can a user finish a real task instead of receiving advice to visit Settings?
- Did any calculation, source, or authorization behavior regress?

Run relevant financial regression tests, typecheck, lint, build, and interaction/authorization tests. Report commands actually run, outputs, skipped tests, and remaining limitations. Do not translate test pass counts into unsupported claims of visual excellence.

## 14. Phase A handoff

Deliver:
- changed files and concise implementation summary;
- exact startup/preview command;
- representative screenshots with paths and viewport/theme labels;
- known integration limitations;
- test results;
- a short design critique against the reference images;
- one focused approval question: whether this visual direction should be applied to the remaining screens.

Do not deploy publicly, send invitations, purchase services, execute payments/payroll/trades, or weaken access controls. Do not claim the entire dashboard was rebuilt when only Phase A was completed.

## 15. Phase B: only after approval

Extend the approved components and composition to Company, Household, Activity, Documents, Settings, subscriptions, planned purchases, and advanced reports. Use the same identity and interaction patterns. Preserve route compatibility and functioning integrations. Re-test the full finance and authorization suite.

Do not use this second phase to revert to repeated cards and long default tables. Dense accounting tables belong in dedicated report views; the normal experience remains assistant-led.

## 16. Reference notes

The art direction and layout measurements in this brief are design decisions, not claims that either coding tool guarantees a particular result.

External implementation references (consult current documentation when needed):
- OpenAI, using Codex with a ChatGPT plan: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- OpenAI, code/design iteration with Codex and Figma: https://developers.openai.com/blog/building-frontend-uis-with-codex-and-figma
- W3C, accessibility target: https://www.w3.org/TR/WCAG22/

Existing user-approved Finance Desk business rules remain the source of product requirements; this file controls the new visual direction and staged delivery.
