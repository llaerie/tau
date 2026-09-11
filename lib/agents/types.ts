/**
 * Internal types shared by the agent layer (base agent, tools, specialists, orchestrator).
 *
 * A tool returns `ToolResult<ToolData>`; the optional `presentation` block is what the
 * base agent turns into the mandatory ExecutiveResponse format. Nothing in a presentation
 * may contain a number that did not come from a CalcResult or dataset record.
 */
import type { z } from "zod";
import type { Escalation, HighRiskBreakdown, KeyFigure, SourceRef, Tool, ToolContext, ToolResult } from "@/lib/core/contracts";
import type { AgentName, KnowledgeLayer, RiskLevel } from "@/lib/core/types";
import type { EducationConceptKey } from "@/lib/knowledge/education";
import type { TaskKind } from "./task-catalog";

/** How a tool wants its result presented. Every field is optional; the composer fills gaps deterministically. */
export interface Presentation {
  answer: string;
  numbers?: KeyFigure[];
  why?: string[];
  whatChanges?: string[];
  risks?: string[];
  recommendation?: string;
  /** Extra structured fields merged into AgentResponse.structured (task-catalog conventions). */
  structured?: Record<string, unknown>;
  escalation?: Escalation;
  highRisk?: HighRiskBreakdown;
  educationKey?: EducationConceptKey;
  confidence?: number;
  sourceLayers?: KnowledgeLayer[];
  sourceRefs?: SourceRef[];
}

/** Data payload convention for every agent tool. */
export interface ToolData {
  presentation?: Presentation;
  [key: string]: unknown;
}

export type AgentTool<I = unknown> = Tool<I, ToolData>;

export interface DefineToolSpec<I> {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  capabilityKey: string;
  inputSchema: z.ZodType<I>;
  execute(input: I, ctx: ToolContext): Promise<ToolResult<ToolData>>;
}

/** Small factory so every tool file reads the same way. */
export function defineTool<I>(spec: DefineToolSpec<I>): AgentTool<I> {
  return spec;
}

/** Result of the natural-language intent router of one agent. */
export interface RouterResult {
  kind: TaskKind;
  params: Record<string, unknown>;
  confidence: number;
  /** Which rule fired (for debugging / tests). */
  rule?: string;
}

export interface TaskResolution {
  kind: TaskKind;
  params: Record<string, unknown>;
  /** "TASK" when the request carried a structured task, "ROUTER" when NL was parsed. */
  via: "TASK" | "ROUTER";
  confidence: number;
}

/** A tool invocation recorded by the base agent (superset of ToolCallRecord). */
export interface ToolRun {
  name: string;
  input: unknown;
  result: ToolResult<ToolData>;
  durationMs: number;
}

export interface AgentDescriptor {
  name: AgentName;
  description: string;
}
