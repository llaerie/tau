import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { submitUiAction } from "@/lib/ui/actions";
import { toPlain } from "@/lib/ui/serialize";
import { sum } from "@/lib/core/money";

/** Propose posting a DRAFT entry. Routine entries execute (GREEN); others create an approval request. */
export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const body = await readJson<{ approvalId?: string; reason?: string }>(req);
  const rt = await getRuntime();
  const entry = rt.dataset.journalEntries.find((e) => e.id === id);
  if (!entry) return apiError(`Entry ${id} not found`, 404, "NOT_FOUND");
  if (entry.status !== "DRAFT" && entry.status !== "PENDING_APPROVAL") return apiError(`Entry is ${entry.status}; only DRAFT entries can be posted`, 409, "INVALID_STATE");
  const period = rt.dataset.periods.find((p) => p.id === entry.periodId);
  const restricted = new Set(rt.dataset.accounts.filter((a) => a.restricted).map((a) => a.id));
  const amount = sum(entry.lines.map((l) => l.debit));
  const result = await submitUiAction(rt, actor, {
    kind: "POST_JOURNAL_ENTRY",
    description: `Post journal entry #${entry.entryNumber}: ${entry.description}`,
    reason: body.reason ?? `Console request to post ${entry.source} entry dated ${entry.date}`,
    targetIds: [entry.id],
    payload: { entryId: entry.id },
    amount: { amount, currency: entry.lines[0]?.currency ?? "USD" },
    sourceDocumentIds: entry.sourceIds,
    reversible: true,
    rollbackPlan: "Reverse the entry with a REVERSAL entry (requires approval).",
    context: {
      periodStatus: period?.status,
      touchesRestrictedAccount: entry.lines.some((l) => restricted.has(l.accountId)),
      isNonStandard: entry.source === "MANUAL" || entry.source === "CORRECTING" || entry.source === "ADJUSTING",
    },
    capabilityKey: "journal_entry_posting",
    approvalId: typeof body.approvalId === "string" ? body.approvalId : undefined,
  });
  return json({ action: toPlain(result) });
}, "PROPOSE_ACTIONS");
