# Authoritative sources (Layer A)

`sources.json` is the seed registry generated from `lib/knowledge/sources.ts`
(`seedKnowledgeSources()`). It lists the IRS, California FTB, California EDD, California
Secretary of State and US DOL pages the system needs.

## No content has been retrieved

This environment cannot reach government websites. Every source is therefore:

- `status: "PENDING_RETRIEVAL"`, `excerpt: ""`, `confidence: 0`, `reviewBy: null`
- tagged `url-unverified` and with a `retrievalInstructions:` tag saying what to capture.

**No tax rate, dollar threshold or due date is encoded anywhere in this layer.** Every
`TaxRule` that depends on these sources is also `PENDING_RETRIEVAL` with no parameters, so the
tax calendar shows `dueDate: null` / `status: UNKNOWN` and every rule lookup escalates to the CPA.

## How retrieval works

1. `HttpSourceRetriever.fetchSource(id)` fetches the URL, strips HTML, stores the first 4,000
   characters as `excerpt`, sets `retrievedAt`, `contentHash` (SHA-256 of the full text) and
   `reviewBy = retrievedAt + 90 days`, and marks the source `CURRENT` with moderate confidence
   and the tag `auto-retrieved:human-review-required`.
2. A human reviews the excerpt and raises confidence / confirms the URL.
3. A CPA-approved `TaxRule` referencing the source is added to the `TaxRuleStore` with
   `status: CURRENT`, parameters, `approvedBy` and a `reviewBy` date.
4. `isStale(source, asOf)` and `TaxRuleStore.markStale(asOf)` retire anything past its review
   date; stale rules are never used — the correct output is an escalation.

`NoNetworkRetriever` is used in this environment and in tests; it returns the source unchanged.
