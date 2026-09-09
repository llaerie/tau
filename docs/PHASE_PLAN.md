# Phase Plan

Autonomy is earned per capability by measured evaluation performance, never granted globally.

| Phase | Data | Writes | Gate to enter |
|---|---|---|---|
| **One — Training Lab** (this repository) | Synthetic company only | None outside the lab dataset | — |
| **Two — Historical read-only** | Real historical bank/card/payroll/invoice exports, loaded READ-ONLY through adapters | None | Finance setup ≥ 80% CONFIRMED; CPA responsibilities confirmed; security items in `docs/SECURITY.md` "Required before Phase Two" complete; evaluation suite green on adversarial and compliance directories |
| **Three — Shadow mode** | Live read-only feeds | CFO proposes every action; humans execute; proposals are scored against what humans did | Two consecutive months of Phase Two with statement reconciliation rate 100% and classification accuracy ≥ 95% on real data |
| **Four — Whitelisted low-risk actions** | Live | GREEN, reversible, whitelisted actions (e.g. categorizing approved recurring merchants, matching exact payments, drafting recurring entries) auto-execute for capabilities at Level ≥ 3 | Shadow-mode false-action rate 0 for 3 months on the whitelisted kinds; owner sign-off per capability |
| **Five — Progressive safe autonomy** | Live | Expanding whitelist as capabilities reach Levels 4–5; RED actions (payments, payroll, tax filing, policy, entity, legal classification) always remain with humans and professionals | Measured thresholds in `lib/academy/certification.ts` |

## What Phase One deliberately does not do

- Connect to any bank, card, payroll, accounting, invoicing or document service.
- Move money, run payroll, file or sign anything, or contact tax authorities.
- Decide reasonable shareholder compensation, worker classification, entity elections, or any tax position.
- Fetch authoritative sources from the network (the environment used to build it has no access;
  sources are registered as `PENDING_RETRIEVAL` with retrieval instructions and a review cadence).

## Fine-tuning

Not part of Phase One. Training v1 is competencies + deterministic tools + authoritative
retrieval + policies + worked examples + large evaluation sets + repeated testing + measured
promotion. Fine-tuning will be evaluated only for narrow, repeatable tasks (e.g. merchant
normalization) if evidence shows a meaningful gain, and never on production financial data
without explicit authorization.
