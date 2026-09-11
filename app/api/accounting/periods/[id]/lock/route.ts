import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { submitUiAction } from "@/lib/ui/actions";
import { toPlain } from "@/lib/ui/serialize";

/** Request a period LOCK (YELLOW) or UNLOCK (RED) through the approval pipeline. */
export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const body = await readJson<{ action?: "LOCK" | "UNLOCK" | "SOFT_CLOSE"; reason?: string; approvalId?: string }>(req);
  const rt = await getRuntime();
  const period = rt.dataset.periods.find((p) => p.id === id);
  if (!period) return apiError(`Period ${id} not found`, 404, "NOT_FOUND");
  if (body.action === "SOFT_CLOSE") {
    const p = rt.ledger.softClosePeriod(period.id, actor);
    await rt.flush();
    return json({ message: `Period ${p.id} soft-closed`, period: toPlain(p) });
  }
  const kind = body.action === "UNLOCK" ? "UNLOCK_PERIOD" : "LOCK_PERIOD";
  if (kind === "LOCK_PERIOD" && period.status === "LOCKED") return apiError("Period is already locked", 409, "INVALID_STATE");
  if (kind === "UNLOCK_PERIOD" && period.status !== "LOCKED") return apiError("Period is not locked", 409, "INVALID_STATE");
  const result = await submitUiAction(rt, actor, {
    kind,
    description: `${kind === "LOCK_PERIOD" ? "Lock" : "Unlock"} accounting period ${period.id}`,
    reason: body.reason ?? (kind === "LOCK_PERIOD" ? "Month-end close complete; lock the period against further posting." : "Reopen a locked period — requires owner/CPA approval and a documented reason."),
    targetIds: [period.id],
    payload: { periodId: period.id, reason: body.reason },
    reversible: kind === "LOCK_PERIOD",
    rollbackPlan: kind === "LOCK_PERIOD" ? "Unlock via an approved UNLOCK_PERIOD request." : "Re-lock the period after the correction is posted.",
    context: { periodStatus: period.status },
    capabilityKey: "period_close",
    approvalId: typeof body.approvalId === "string" ? body.approvalId : undefined,
  });
  return json({ action: toPlain(result) });
}, "LOCK_PERIOD");
