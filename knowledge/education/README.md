# Owner education

`lib/knowledge/education.ts` holds 20 short "Why this matters" snippets (2–5 sentences each)
keyed by concept: cash_vs_profit, gross_vs_net, accrual_basis, owner_salary_vs_distribution,
working_capital, cash_runway, npv, reasonable_compensation, related_party, prepaid_amortization,
depreciation, payroll_liabilities, thirteen_week_cash, budget_variance, contribution_margin,
break_even, ar_aging, period_lock, personal_business_separation, estimated_taxes.

`educationFor(key)` returns one snippet; `conceptsForTopic(topic)` lists snippets for a topic
(`accounting`, `cash`, `payroll`, `tax`, `planning`, `controls`, `finance`).

Snippets teach concepts only. They never state tax rates, thresholds or legal conclusions, and
they are indexed in the retrieval corpus under the `EDUCATION` layer so agents can attach an
"education" block to an `ExecutiveResponse`.
