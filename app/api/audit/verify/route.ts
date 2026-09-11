import { getRuntime } from "@/lib/db/runtime";
import { withApi, json } from "@/lib/ui/api";
import { verifyEventChain } from "@/lib/audit/audit-log";

export const GET = withApi(async () => {
  const rt = await getRuntime();
  const verification = verifyEventChain(rt.dataset.auditEvents);
  return json({ verification, checkedAt: new Date().toISOString() });
}, "VIEW_AUDIT");
