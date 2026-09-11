import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { toPlain } from "@/lib/ui/serialize";
import { executeApproved } from "@/lib/ui/actions";
import { isPhaseOneProhibited } from "@/lib/risk/risk-engine";

export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, ctx, actor) => {
  const { id } = await ctx.params;
  const body = await readJson<{ decision?: string; comment?: string }>(req);
  if (body.decision !== "APPROVED" && body.decision !== "REJECTED") return apiError("decision must be APPROVED or REJECTED");
  const rt = await getRuntime();
  const approval = await rt.approvals.decide(id, body.decision, actor, typeof body.comment === "string" ? body.comment : undefined);
  let execution = null;
  if (approval.status === "APPROVED") execution = await executeApproved(rt, actor, approval.id);
  await rt.flush();
  return json({
    approval: toPlain(approval),
    execution: execution ? toPlain(execution) : null,
    phaseOneProhibited: isPhaseOneProhibited(approval.action.kind),
  });
});
