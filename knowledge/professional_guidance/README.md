# Professional guidance (Layer B)

Professional guidance is advice received from a CPA, attorney, payroll professional or auditor.
It is stored by `lib/knowledge/guidance.ts` (`GuidanceStore`).

Lifecycle: `PENDING_APPROVAL` → `ACTIVE` (approved by a human in an approver role) →
optionally promoted to a versioned company `Policy` with `promoteGuidanceToPolicy()`
(new version ACTIVE, prior versions SUPERSEDED) → `SUPERSEDED` when replaced.

Agents may never author, approve or promote guidance.

## Real guidance

**None has been received.** `seedRealGuidance()` returns an empty list. When the CPA sends a
memo, add it as a document, register it with `GuidanceStore.add()`, and have the owner or the
professional approve it.

## Synthetic example

`synthetic-meals-documentation-memo.md` is a clearly labelled **[SYNTHETIC LAB EXAMPLE]** used
to exercise the pipeline. It asserts no tax law and is not advice.
