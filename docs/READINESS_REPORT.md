# Tau AI CFO — Readiness Report

Generated 2026-09-11T02:27:27.752Z. **This system is NOT production-ready. Phase One runs exclusively on synthetic data; no real bank, payroll, tax or accounting integration is live and no real money moves. No score in this report changes that.**

## Overall competency

- Run: `run_20260911022721_b71ea6c6` at 2026-09-11T02:27:21.271Z — model local/local-deterministic (deterministic)
- Cases: 746 — passed 746, failed 0 — pass rate **100.0%**

| Metric | Value |
|---|---|
| exactCalculationAccuracy | 100.0% |
| reconciliationAccuracy | 100.0% |
| classificationAccuracy | 100.0% |
| escalationAccuracy | 100.0% |
| statementReconciliationRate | 100.0% |
| varianceExplanationQuality | 100.0% |
| falseActionRate | 0.0% |
| hallucinationRate | 0.0% |
| unsupportedSourceRate | 0.0% |
| passRate | 100.0% |
| count | 746 |

- Capability levels: L0 × 5, L1 × 35 (autonomy is granted per capability, never globally)

## Accounting score

100.0% — 150/150 cases passed (evals/accounting).

## FP&A score

100.0% — 96/96 cases passed (evals/fpa).

## Cash score

100.0% — 68/68 cases passed (evals/cash).

## Tax operations score

100.0% — 95/95 cases passed (evals/tax).

## Payroll score

100.0% — 73/73 cases passed (evals/payroll).

## AP/AR score

100.0% — 58/58 cases passed (evals/ap_ar).

## Strategy score

100.0% — 71/71 cases passed (evals/strategy).

## Compliance score

100.0% — 72/72 cases passed (evals/compliance).

## Safety score (adversarial)

100.0% — 63/63 cases passed (evals/adversarial).

## Capabilities certified for autonomous use (level ≥3)

None.

## Capabilities requiring approval (levels 1–2)

| Capability | Domain | Level | Phase One cap | Run pass rate | High risk |
|---|---|---|---|---|---|
| Transaction categorization (`transaction_categorization`) | ACCOUNTING_FOUNDATIONS | 1 Apprentice | 5 | 100.0% (31) | no |
| Duplicate detection (`duplicate_detection`) | ACCOUNTING_FOUNDATIONS | 1 Apprentice | 5 | 100.0% (1) | no |
| Transfer matching (`transfer_matching`) | ACCOUNTING_FOUNDATIONS | 1 Apprentice | 5 | 100.0% (3) | no |
| Receipt matching (`receipt_matching`) | ACCOUNTING_FOUNDATIONS | 1 Apprentice | 5 | 100.0% (14) | no |
| Journal entry drafting (`journal_entry_drafting`) | ACCOUNTING_FOUNDATIONS | 1 Apprentice | 5 | 100.0% (91) | no |
| Journal entry posting (`journal_entry_posting`) | ACCOUNTING_FOUNDATIONS | 1 Apprentice | 5 | 100.0% (1) | yes |
| Accruals and prepaids (`accruals_prepaids`) | ADVANCED_ACCOUNTING | 1 Apprentice | 5 | 100.0% (12) | no |
| Depreciation (`depreciation`) | ADVANCED_ACCOUNTING | 1 Apprentice | 5 | 100.0% (8) | no |
| Bank reconciliation (`bank_reconciliation`) | ACCOUNTING_FOUNDATIONS | 1 Apprentice | 5 | 100.0% (2) | no |
| Financial statements (`financial_statements`) | FINANCIAL_STATEMENT_ANALYSIS | 1 Apprentice | 5 | 100.0% (27) | no |
| Period close (`period_close`) | ADVANCED_ACCOUNTING | 1 Apprentice | 5 | 100.0% (11) | yes |
| Budgeting (`budgeting`) | FPA | 1 Apprentice | 5 | 100.0% (7) | no |
| Rolling forecast (`rolling_forecast`) | FPA | 1 Apprentice | 5 | 100.0% (5) | no |
| Variance analysis (`variance_analysis`) | FPA | 1 Apprentice | 5 | 100.0% (43) | no |
| Scenario analysis (`scenario_analysis`) | FPA | 1 Apprentice | 5 | 100.0% (18) | no |
| 13-week cash flow (`thirteen_week_cash`) | CASH_MANAGEMENT | 1 Apprentice | 5 | 100.0% (29) | no |
| Liquidity monitoring (`liquidity_monitoring`) | CASH_MANAGEMENT | 1 Apprentice | 5 | 100.0% (45) | no |
| AR invoicing (`ar_invoicing`) | AP_AR | 1 Apprentice | 5 | 100.0% (5) | no |
| AR collections (`ar_collections`) | AP_AR | 1 Apprentice | 5 | 100.0% (12) | no |
| AP bill intake (`ap_bill_intake`) | AP_AR | 1 Apprentice | 5 | 100.0% (18) | no |
| AP payment scheduling (`ap_payment_scheduling`) | AP_AR | 1 Apprentice | 5 | 100.0% (2) | yes |
| Payroll monitoring (`payroll_monitoring`) | PAYROLL_WORKFORCE | 1 Apprentice | 5 | 100.0% (48) | no |
| Payroll reconciliation (`payroll_reconciliation`) | PAYROLL_WORKFORCE | 1 Apprentice | 5 | 100.0% (7) | no |
| Tax calendar (`tax_calendar`) | TAX_OPERATIONS | 1 Apprentice | 5 | 100.0% (8) | yes |
| Tax workpapers (`tax_workpapers`) | TAX_OPERATIONS | 1 Apprentice | 5 | 100.0% (84) | yes |
| CPA package (`cpa_package`) | TAX_OPERATIONS | 1 Apprentice | 5 | 100.0% (6) | yes |
| Document classification (`document_classification`) | FINANCIAL_CONTROLS | 1 Apprentice | 5 | 100.0% (1) | no |
| Retention management (`retention_management`) | FINANCIAL_CONTROLS | 1 Apprentice | 5 | 100.0% (1) | no |
| Strategic analysis (`strategic_analysis`) | CFO_STRATEGY | 1 Apprentice | 5 | 100.0% (5) | no |
| Investment analysis (`investment_analysis`) | CORPORATE_FINANCE | 1 Apprentice | 5 | 100.0% (38) | no |
| Pricing analysis (`pricing_analysis`) | CFO_STRATEGY | 1 Apprentice | 5 | 100.0% (17) | no |
| Hiring analysis (`hiring_analysis`) | CFO_STRATEGY | 1 Apprentice | 5 | 100.0% (28) | no |
| Internal audit (`internal_audit`) | FINANCIAL_CONTROLS | 1 Apprentice | 5 | 100.0% (67) | no |
| Policy management (`policy_management`) | FINANCIAL_CONTROLS | 1 Apprentice | 5 | 100.0% (5) | yes |
| Education (`education`) | CFO_STRATEGY | 1 Apprentice | 5 | 100.0% (1) | no |

## Capabilities prohibited (level 0 / phase-one prohibited kinds)

| Capability | Domain | Level | Phase One cap | Run pass rate | High risk |
|---|---|---|---|---|---|
| Payment execution (`payment_execution`) | CASH_MANAGEMENT | 0 Untrained | 2 | 100.0% (12) | yes |
| Payroll execution (`payroll_execution`) | PAYROLL_WORKFORCE | 0 Untrained | 2 | 100.0% (9) | yes |
| Worker classification (`worker_classification`) | PAYROLL_WORKFORCE | 0 Untrained | 2 | 100.0% (12) | yes |
| International worker compliance (`international_worker_compliance`) | PAYROLL_WORKFORCE | 0 Untrained | 2 | 100.0% (2) | yes |
| Tax filing (`tax_filing`) | TAX_OPERATIONS | 0 Untrained | 2 | 100.0% (10) | yes |

Phase One prohibited action kinds (never execute, even with an approval): `EXECUTE_PAYMENT`, `RUN_PAYROLL`, `CHANGE_PAYROLL`, `FILE_TAX_RETURN`, `PAY_TAX`, `SIGN_DOCUMENT`, `RESPOND_TO_TAX_AUTHORITY`, `CHANGE_ENTITY`, `DELETE_RECORD`.

## Known weaknesses

- None identified in the latest run.

## Failed evaluations (ids + reasons)

None.

## Missing company data (unknowns registry)

26 setup item(s) are not CONFIRMED:

| Item | Status | Who can answer | Blocks |
|---|---|---|---|
| Legal company name (`entity_profile.legal_name`) | UNCONFIRMED | OWNER | cpa_package, entity_compliance |
| EIN storage / reference architecture (`entity_profile.ein_vault_reference`) | UNCONFIRMED | OWNER | cpa_package, entity_compliance |
| Business address (`entity_profile.business_address`) | UNCONFIRMED | OWNER | entity_compliance, cpa_package |
| Fiscal year (`entity_profile.fiscal_year`) | UNCONFIRMED | CPA | tax_calendar, tax_workpapers, period_close |
| Accounting method (cash vs accrual) (`accounting_policies.accounting_method`) | UNCONFIRMED | CPA | financial_statements, tax_workpapers, budget_variance |
| CPA identity (`cpa.identity`) | UNCONFIRMED | OWNER | cpa_package |
| CPA responsibilities (`cpa.responsibilities`) | PROFESSIONAL_REVIEW_REQUIRED | CPA | tax_calendar, cpa_package, payroll_monitoring |
| Bank accounts (`bank_accounts.accounts`) | UNCONFIRMED | OWNER | bank_reconciliation, transaction_categorization, thirteen_week_cash, financial_statements |
| Cards (`cards.cards`) | UNCONFIRMED | OWNER | transaction_categorization, bank_reconciliation, missing_document_alerts |
| Payroll provider (`payroll_provider.provider`) | UNCONFIRMED | OWNER | payroll_monitoring, tax_calendar |
| Employee compensation (incl. the ~$8,000/month basis question) (`employees.allocation_basis`) | UNCONFIRMED | OWNER | payroll_monitoring, thirteen_week_cash, budget_variance |
| China worker classification (`international_workforce.china_worker_classification`) | PROFESSIONAL_REVIEW_REQUIRED | CPA | worker_classification, payroll_monitoring, tax_workpapers |
| Invoicing process (`customers.invoicing_process`) | UNCONFIRMED | OWNER | ar_management, financial_statements |
| Customer entity (`customers.primary_customer_entity`) | UNCONFIRMED | OWNER | ar_management, related_party_disclosure, cpa_package |
| Payment terms (`customers.payment_terms`) | UNCONFIRMED | OWNER | ar_management, thirteen_week_cash |
| Formal service agreement (`customers.formal_service_agreement`) | UNCONFIRMED | OWNER | related_party_disclosure, cpa_package |
| Business insurance (`insurance.business_insurance`) | UNCONFIRMED | OWNER | budget_variance, risk_assessment |
| Tax payment history (`tax_calendar.tax_payment_history`) | UNCONFIRMED | CPA | tax_calendar, tax_workpapers |
| Prior tax returns (`tax_calendar.prior_tax_returns`) | UNCONFIRMED | CPA | tax_workpapers, cpa_package, fixed_asset_depreciation |
| Opening balances (`accounting_policies.opening_balances`) | UNCONFIRMED | CPA | financial_statements, bank_reconciliation, period_close |
| Fixed assets (`accounting_policies.fixed_assets`) | UNCONFIRMED | OWNER | fixed_asset_depreciation, tax_workpapers |
| Loans (`accounting_policies.loans`) | UNCONFIRMED | OWNER | financial_statements, related_party_disclosure, distribution_planning |
| Owner basis information (`ownership.owner_basis`) | UNCONFIRMED | CPA | distribution_planning, tax_workpapers |
| Chart of accounts (`chart_of_accounts.confirmed_chart`) | UNCONFIRMED | CPA | transaction_categorization, financial_statements |
| Reimbursement rules (`reimbursement_policy.rules`) | UNCONFIRMED | OWNER | transaction_categorization, ap_management |
| Approval thresholds (`approval_matrix.thresholds`) | UNCONFIRMED | OWNER | risk_assessment, ap_management |

## Professional reviews required

- CPA: confirm "Fiscal year" (entity_profile.fiscal_year) — The tax calendar, year-end close and every annual comparison depend on the fiscal year end. It must not be assumed.
- CPA: confirm "Accounting method (cash vs accrual)" (accounting_policies.accounting_method) — Cash and accrual books produce different revenue, expense and AR/AP timing. The ledger cannot be interpreted correctly until the method is confirmed.
- CPA: confirm "CPA responsibilities" (cpa.responsibilities) — Whether the CPA files payroll returns, prepares the 1120-S, or only advises decides which obligations the system must track itself.
- CPA: confirm "China worker classification" (international_workforce.china_worker_classification) — Cross-border worker status drives withholding, documentation and possible foreign obligations. It is a professional decision, never an AI decision.
- CPA: confirm "Tax payment history" (tax_calendar.tax_payment_history) — Prior payments determine what is already satisfied and what is outstanding; the calendar is incomplete without them.
- CPA: confirm "Prior tax returns" (tax_calendar.prior_tax_returns) — Prior returns establish the accounting method, fiscal year, basis, depreciation history and carryforwards.
- CPA: confirm "Opening balances" (accounting_policies.opening_balances) — The ledger cannot produce a balance sheet that ties to reality without confirmed opening balances.
- CPA: confirm "Owner basis information" (ownership.owner_basis) — Distributions beyond basis have tax consequences; the system cannot evaluate a distribution without basis data from the CPA.
- CPA: confirm "Chart of accounts" (chart_of_accounts.confirmed_chart) — Categorization confidence depends on an agreed chart; the lab template is a proposal until the CPA confirms it.
- CPA: 21 seeded tax rules are PENDING_RETRIEVAL (no rate, threshold or due date is usable until retrieved from the authoritative source and confirmed).
- ATTORNEY + CPA: classification, withholding and documentation for the two China-based workers (never an AI decision).
- CPA: reasonable compensation for the shareholder-employee; wages vs distributions split.
- 104 evaluation response(s) in the latest run escalated to CPA / professional review (expected behaviour for rule-less tax, classification and compensation questions).

## Recommended next phase

- Stay in Phase One (synthetic lab). Do not connect real bank, payroll, tax or accounting systems.
- Accumulate consecutive passing runs per capability; promotion to Level 3 additionally requires ≥20 evaluations, 0% false actions, ≤2% hallucination and ≥95% escalation accuracy (see lib/academy/certification.ts).
- Resolve the 26 unconfirmed setup items with the owner, CPA and attorney before any real-company data is loaded.
- Retrieve and CPA-confirm the authoritative tax sources so tax rules become usable data instead of escalations.
- Phase Two gate: read-only connection to real data, still Level ≤2 for every high-risk capability, with human execution of every action.

> This system is NOT production-ready. Phase One runs exclusively on synthetic data; no real bank, payroll, tax or accounting integration is live and no real money moves. No score in this report changes that.
