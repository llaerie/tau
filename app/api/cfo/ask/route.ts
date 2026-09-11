import { getRuntime } from "@/lib/db/runtime";
import { withApi, json, apiError, readJson } from "@/lib/ui/api";
import { loadAgents, MODULE_NOT_AVAILABLE } from "@/lib/ui/optional";
import { toPlain } from "@/lib/ui/serialize";
import { isTaskKind } from "@/lib/agents/task-catalog";
import type { AgentResponse } from "@/lib/core/contracts";
import type { AgentName, ISODate } from "@/lib/core/types";

interface AskBody {
  message?: string;
  task?: { kind: string; params?: Record<string, unknown> };
  asOfDate?: ISODate;
  targetAgent?: AgentName;
}

type AskFn = (rt: unknown, message: string, opts: Record<string, unknown>) => Promise<AgentResponse>;

export const POST = withApi(async (req, _ctx, actor) => {
  const body = await readJson<AskBody>(req);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message && !body.task) return apiError("message or task is required");
  if (body.task && !isTaskKind(body.task.kind)) return apiError(`Unknown task kind ${body.task.kind}`, 400, "UNKNOWN_TASK");
  const { mod, notice } = await loadAgents<{ askCfo?: AskFn }>("ask");
  if (!mod || typeof mod.askCfo !== "function") return apiError(notice ?? `askCfo: ${MODULE_NOT_AVAILABLE}`, 503, "MODULE_NOT_AVAILABLE");
  const rt = await getRuntime();
  const response = await mod.askCfo(rt, message || `Run ${body.task?.kind}`, { task: body.task, actor, asOfDate: body.asOfDate, targetAgent: body.targetAgent });
  await rt.flush();
  return json({ response: toPlain(response) });
}, "VIEW_FINANCIALS");
