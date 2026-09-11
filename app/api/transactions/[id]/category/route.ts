import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { submitUiAction } from "@/lib/ui/actions";
import { toPlain } from "@/lib/ui/serialize";
import { abs } from "@/lib/core/money";

/** Approve a category suggestion: creates a governed CATEGORIZE_TRANSACTION action (YELLOW ones go to approvals). */
export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const body = await readJson<{ accountId?: string; reason?: string }>(req);
  const rt = await getRuntime();
  const tx = rt.dataset.transactions.find((t) => t.id === id);
  if (!tx) return apiError(`Transaction ${id} not found`, 404, "NOT_FOUND");
  const accountId = typeof body.accountId === "string" && body.accountId ? body.accountId : tx.category.accountId;
  if (!accountId) return apiError("No suggested category to approve; choose an account", 422, "NO_CATEGORY");
  const account = rt.dataset.accounts.find((a) => a.id === accountId);
  if (!account) return apiError(`Account ${accountId} not found`, 404, "NOT_FOUND");
  const isNewCategory = tx.category.accountId !== accountId;
  const result = await submitUiAction(rt, actor, {
    kind: "CATEGORIZE_TRANSACTION",
    description: `Categorize ${tx.descriptionRaw} (${tx.date}) as ${account.code} ${account.name}`,
    reason: body.reason ?? tx.category.reason ?? "Approved from the transactions console",
    targetIds: [tx.id],
    payload: { accountId, reason: body.reason ?? tx.category.reason },
    amount: { amount: abs(tx.amount), currency: tx.currency },
    confidence: isNewCategory ? 0.9 : tx.category.confidence,
    reversible: true,
    rollbackPlan: "Re-open the category (status SUGGESTED) and re-classify.",
    sourceDocumentIds: tx.documentIds,
    context: {
      isNewCategory,
      isPersonalMixed: tx.flags.includes("POSSIBLE_PERSONAL"),
      isNewVendor: tx.flags.includes("NEW_MERCHANT"),
      involvesRelatedParty: tx.flags.includes("RELATED_PARTY"),
      touchesRestrictedAccount: !!account.restricted,
    },
    capabilityKey: "transaction_categorization",
  });
  return json({ action: toPlain(result) });
}, "PROPOSE_ACTIONS");
