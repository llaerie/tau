import { resetRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { ensureUiHandlers } from "@/lib/ui/actions";

/** Regenerate the synthetic company and discard the lab snapshot. Requires the confirmation phrase. */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<{ confirm?: string; seed?: number; asOfDate?: string }>(req);
  if (body.confirm !== "RESET LAB") return apiError('Type the confirmation phrase "RESET LAB"', 400, "CONFIRMATION_REQUIRED");
  const rt = await resetRuntime({ asOfDate: typeof body.asOfDate === "string" ? body.asOfDate : undefined });
  ensureUiHandlers(rt);
  await rt.audit.record({ actor, workflowVersion: "console:lab:v1", eventType: "LAB_RESET", explanation: "Lab data regenerated from the synthetic generator via the console; prior snapshot discarded." });
  await rt.flush();
  return json({ message: `Lab reset. ${rt.dataset.profile.displayName} regenerated as of ${rt.asOfDate}.`, asOfDate: rt.asOfDate, counts: { transactions: rt.dataset.transactions.length, journalEntries: rt.dataset.journalEntries.length } });
}, "MANAGE_USERS");
