/** Ledger integrity failures: ERROR-severity checks are CRITICAL, warnings are WARNING. */
import { makeItem } from "../helpers";
import type { AttentionItem, Monitor } from "../types";

export const statementsNotReconciling: Monitor = {
  key: "statements_not_reconciling",
  description: "Financial statements or ledger invariants do not reconcile (integrity checks).",
  run(ctx): AttentionItem[] {
    const report = ctx.ledger.runIntegrityChecks(ctx.asOf);
    return report.checks
      .filter((c) => !c.passed)
      .map((c) =>
        makeItem(ctx, {
          kind: "statements_not_reconciling",
          severity: c.severity === "ERROR" ? "CRITICAL" : "WARNING",
          title: `Integrity check failed: ${c.label}`,
          detail: `${c.key}: ${c.details ?? "no details"} (as of ${ctx.asOf}).${c.severity === "ERROR" ? " ERROR-level failures block period lock." : ""}`,
          relatedIds: [c.key],
          sourceIds: [],
          suggestedTask: { kind: "accounting.integrity_check", params: { asOf: ctx.asOf } },
        }),
      );
  },
};
