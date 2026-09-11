/** Agent registry: builds the orchestrator and the eleven specialists. */
import type { Agent } from "@/lib/core/contracts";
import type { AgentName } from "@/lib/core/types";
import { CfoOrchestrator } from "./orchestrator";
import { createApAgent, createArAgent, createAuditorAgent, createBookkeepingAgent, createControllerAgent, createDocumentsAgent, createFpaAgent, createPayrollAgent, createStrategyAgent, createTaxAgent, createTreasuryAgent } from "./specialists";

export interface AgentSet {
  orchestrator: CfoOrchestrator;
  specialists: Record<AgentName, Agent>;
}

export function createAgents(): AgentSet {
  const list: Agent[] = [createControllerAgent(), createBookkeepingAgent(), createFpaAgent(), createTreasuryAgent(), createApAgent(), createArAgent(), createPayrollAgent(), createTaxAgent(), createDocumentsAgent(), createStrategyAgent(), createAuditorAgent()];
  const byName = Object.fromEntries(list.map((a) => [a.name, a])) as Record<AgentName, Agent>;
  const orchestrator = new CfoOrchestrator(byName);
  byName.cfo_orchestrator = orchestrator;
  return { orchestrator, specialists: byName };
}

let shared: AgentSet | null = null;
/** Process-wide agent set (agents are stateless; safe to share). */
export function getAgents(): AgentSet {
  if (!shared) shared = createAgents();
  return shared;
}
