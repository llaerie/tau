/**
 * Optional model-written narrative. Only used when the configured reasoning model is NOT the
 * local deterministic provider. The model may rephrase ANSWER / WHY / RECOMMENDATION given the
 * structured facts; every number in its text must already exist in the deterministic numbers,
 * otherwise the narrative is rejected and the deterministic text is kept. Secrets never leave.
 */
import { z } from "zod";
import type { ExecutiveResponse, ToolContext } from "@/lib/core/contracts";
import type { CalcResult } from "@/lib/core/types";
import { PROMPT_VERSION, renderPrompt } from "@/lib/models/prompt-versions";
import { assertNoSecretsInText, redactForModel } from "@/lib/security";
import { checkNarrativeNumbers, collectNumbers, extractNumbersFromText } from "./numeric-guard";

export const NARRATIVE_PROMPT_VERSION = `${PROMPT_VERSION}:narrative-v1`;

const NarrativeSchema = z.object({ answer: z.string().min(1), why: z.array(z.string()).max(8), recommendation: z.string().min(1) });

export interface NarrativeOutcome {
  response: ExecutiveResponse;
  /** "kept" (deterministic), "rewritten", "narrative_rejected", "narrative_error" */
  status: "kept" | "rewritten" | "narrative_rejected" | "narrative_error";
  note?: string;
}

/** Build the set of numbers the model is allowed to mention. */
export function allowedNumberSet(response: ExecutiveResponse, structured: Record<string, unknown>, calcs: CalcResult[]): Set<number> {
  const allowed = collectNumbers(structured);
  for (const c of calcs) collectNumbers(c.value, allowed);
  for (const n of response.numbers) for (const x of extractNumbersFromText(n.value)) allowed.add(x.value);
  for (const line of [...response.why, ...response.risks, ...response.sourcesAndAssumptions, response.answer]) for (const x of extractNumbersFromText(line)) allowed.add(x.value);
  return allowed;
}

export async function maybeRewriteNarrative(ctx: ToolContext, response: ExecutiveResponse, structured: Record<string, unknown>, calcs: CalcResult[]): Promise<NarrativeOutcome> {
  const model = ctx.models.reasoning;
  if (model.info.deterministic) return { response, status: "kept" };
  try {
    const facts = redactForModel({
      answer: response.answer,
      numbers: response.numbers,
      why: response.why,
      whatChanges: response.whatChanges,
      risks: response.risks,
      recommendation: response.recommendation,
      needsApproval: response.needsApproval,
      escalation: structured.escalation ?? null,
      highRisk: response.highRisk ?? null,
    });
    const userText = [
      "Rewrite the ANSWER, WHY and RECOMMENDATION below for a business owner in plain, calm language.",
      "Rules: do not introduce any number that is not present in the facts; do not change conclusions; do not state tax rates or legal conclusions; keep escalations intact.",
      "Respond with JSON only: {\"answer\": string, \"why\": string[], \"recommendation\": string}.",
      "FACTS:",
      JSON.stringify(facts),
    ].join("\n");
    assertNoSecretsInText(userText, "narrative prompt");
    const res = await model.complete({
      messages: [
        { role: "system", content: renderPrompt("cfo.system") },
        { role: "user", content: userText },
      ],
      jsonSchema: { type: "object", properties: { answer: { type: "string" }, why: { type: "array", items: { type: "string" } }, recommendation: { type: "string" } }, required: ["answer", "why", "recommendation"] },
      maxTokens: 800,
      temperature: 0,
      metadata: { promptVersion: NARRATIVE_PROMPT_VERSION },
    });
    let parsed: unknown = res.json;
    if (parsed === undefined) {
      try {
        parsed = JSON.parse(res.text);
      } catch {
        parsed = undefined;
      }
    }
    const validated = NarrativeSchema.safeParse(parsed);
    if (!validated.success) return { response, status: "narrative_rejected", note: "narrative_rejected: model output did not match the schema" };
    const text = [validated.data.answer, ...validated.data.why, validated.data.recommendation].join("\n");
    const guard = checkNarrativeNumbers(text, allowedNumberSet(response, structured, calcs));
    if (!guard.ok) return { response, status: "narrative_rejected", note: `narrative_rejected: unsupported numbers in model narrative: ${guard.unsupported.join(", ")}` };
    return { response: { ...response, answer: validated.data.answer, why: validated.data.why.length ? validated.data.why : response.why, recommendation: validated.data.recommendation }, status: "rewritten" };
  } catch (err) {
    return { response, status: "narrative_error", note: `narrative_error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
