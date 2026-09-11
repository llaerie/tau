import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError } from "@/lib/ui/api";
import { whyDidTheCfoDoThis } from "@/lib/audit/explain";
import { toPlain } from "@/lib/ui/serialize";

/** GET ?id=<action|approval|entry|calc|document id> → explanation chain. */
export const GET = withApi(async (req) => {
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return apiError("id is required");
  const rt = await getRuntime();
  const explanation = whyDidTheCfoDoThis(rt.audit, rt.dataset, id);
  return json({ explanation: toPlain(explanation) });
}, "VIEW_AUDIT");
