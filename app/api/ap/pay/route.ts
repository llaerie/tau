import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { submitUiAction } from "@/lib/ui/actions";
import { toPlain } from "@/lib/ui/serialize";
import { sub } from "@/lib/core/money";
import { isPhaseOneProhibited } from "@/lib/risk/risk-engine";

/** "Pay" a bill: the action is proposed through governance and is always BLOCKED in Phase One (simulation only). */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<{ billId?: string; mode?: "EXECUTE" | "SCHEDULE" }>(req);
  const rt = await getRuntime();
  const bill = rt.dataset.bills.find((b) => b.id === body.billId);
  if (!bill) return apiError("billId not found", 404, "NOT_FOUND");
  const open = sub(bill.total, bill.amountPaid);
  const vendor = rt.dataset.vendors.find((v) => v.id === bill.vendorId);
  const kind = body.mode === "SCHEDULE" ? "SCHEDULE_PAYMENT" : "EXECUTE_PAYMENT";
  const result = await submitUiAction(rt, actor, {
    kind,
    description: `${kind === "EXECUTE_PAYMENT" ? "Pay" : "Schedule payment for"} bill ${bill.number} to ${vendor?.name ?? bill.vendorId} (${open})`,
    reason: "Requested from the payables console",
    targetIds: [bill.id],
    payload: { billId: bill.id, vendorId: bill.vendorId, dueDate: bill.dueDate },
    amount: { amount: open, currency: bill.currency },
    reversible: kind !== "EXECUTE_PAYMENT",
    rollbackPlan: kind === "EXECUTE_PAYMENT" ? "Money movement is irreversible; Phase One never executes it." : "Cancel the scheduled payment before the run date.",
    sourceDocumentIds: bill.documentId ? [bill.documentId] : [],
    context: { movesMoney: kind === "EXECUTE_PAYMENT", isNewVendor: vendor ? !vendor.approvedBy : true, isRecurringApproved: !!vendor?.isRecurring && !!vendor?.approvedBy },
    capabilityKey: kind === "EXECUTE_PAYMENT" ? "payment_execution" : "ap_payment_scheduling",
  });
  return json({ action: toPlain(result), phaseOneProhibited: isPhaseOneProhibited(kind), message: isPhaseOneProhibited(kind) ? "BLOCKED — Phase One is simulation only. No payment rails are connected and EXECUTE_PAYMENT never runs, even when approved." : undefined });
}, "PROPOSE_ACTIONS");
