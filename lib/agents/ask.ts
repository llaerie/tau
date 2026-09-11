/** askCfo — convenience entry point used by the UI, evals and scripts. */
import type { AgentRequest, AgentResponse } from "@/lib/core/contracts";
import type { Actor, AgentName, ISODate } from "@/lib/core/types";
import { toolContextFor, type LabRuntime } from "@/lib/db/runtime";
import { LAB_DEFAULT_ACTOR } from "@/lib/security/session";
import { getAgents } from "./registry";

export interface AskOptions {
  task?: AgentRequest["task"];
  actor?: Actor;
  asOfDate?: ISODate;
  targetAgent?: AgentName;
  conversationId?: string;
}

export async function askCfo(rt: LabRuntime, message: string, opts: AskOptions = {}): Promise<AgentResponse> {
  const actor = opts.actor ?? LAB_DEFAULT_ACTOR;
  const ctx = toolContextFor(rt, "cfo_orchestrator", actor, opts.asOfDate);
  const { orchestrator } = getAgents();
  return orchestrator.handle({ message, task: opts.task, actor, asOfDate: opts.asOfDate ?? rt.asOfDate, targetAgent: opts.targetAgent, conversationId: opts.conversationId }, ctx);
}
