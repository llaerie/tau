import { currentWorkspace, resetRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { ensureUiHandlers } from "@/lib/ui/actions";

/**
 * Lab: regenerate the synthetic company and discard the lab snapshot ("RESET LAB").
 * Company workspace: destructive — discards the owners' real entries — so it demands the
 * phrase "RESET COMPANY" and passes the explicit confirmation the runtime requires.
 */
export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<{ confirm?: string; seed?: number; asOfDate?: string }>(req);
  const company = currentWorkspace() === "company";
  if (company && body.confirm !== "RESET COMPANY") return apiError('This is the COMPANY workspace: resetting deletes the owners\' real entries. Type the confirmation phrase "RESET COMPANY" (or run `npm run company:init -- --force`).', 409, "CONFIRMATION_REQUIRED");
  if (!company && body.confirm !== "RESET LAB") return apiError('Type the confirmation phrase "RESET LAB"', 400, "CONFIRMATION_REQUIRED");
  const rt = await resetRuntime({ asOfDate: typeof body.asOfDate === "string" ? body.asOfDate : undefined, confirmCompanyReset: company });
  ensureUiHandlers(rt);
  await rt.audit.record({ actor, workflowVersion: "console:lab:v1", eventType: company ? "COMPANY_WORKSPACE_RESET" : "LAB_RESET", explanation: company ? "Company workspace reset to an empty dataset via the console with explicit confirmation; prior snapshot discarded." : "Lab data regenerated from the synthetic generator via the console; prior snapshot discarded." });
  await rt.flush();
  return json({ message: company ? `Company workspace reset to empty books as of ${rt.asOfDate}.` : `Lab reset. ${rt.dataset.profile.displayName} regenerated as of ${rt.asOfDate}.`, asOfDate: rt.asOfDate, counts: { transactions: rt.dataset.transactions.length, journalEntries: rt.dataset.journalEntries.length } });
}, "MANAGE_USERS");
