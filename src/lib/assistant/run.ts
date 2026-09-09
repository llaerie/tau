import Anthropic from "@anthropic-ai/sdk";
import type { Viewer } from "../auth/session";
import { getConfig } from "../config";
import { previewRouter } from "./preview";
import { executeTool, TOOL_DEFINITIONS, ToolError, type ToolCall } from "./tools";

export interface AssistantTurn {
  role: "user" | "assistant";
  text: string;
  mode?: "claude" | "preview";
  toolCalls?: ToolCall[];
  createdAt: string;
}

const SYSTEM_PROMPT = `You are the Finance Desk assistant for a small company and the household of its two owners.

Rules you must follow:
- Every number you state must come from a tool result in this conversation. Never estimate, extrapolate or invent figures. If a tool reports something as unknown, say it is unknown and where it can be entered; never treat it as zero.
- Company revenue is company money, never personal take-home. Owner salaries are gross, not spending allowances. Net take-home depends on a withholding estimate.
- Goals are funded in priority order; the friends-travel goal comes before discretionary spending.
- Show shortfalls plainly. Do not suggest changing assumptions to make something look affordable.
- State the assumptions and caveats the tools return. Keep answers short and concrete, in plain prose with at most a few short bullet points.
- You cannot move money, run payroll, file taxes, buy anything or send invitations. Do not offer to.
- The user can only see the spaces the tools return; do not speculate about spaces you cannot access.`;

const MAX_ITERATIONS = 6;

export async function runAssistant(viewer: Viewer, history: AssistantTurn[], message: string): Promise<AssistantTurn> {
  const config = getConfig();
  const createdAt = new Date().toISOString();
  if (!config.anthropicApiKey) {
    const { toolCalls, text } = previewRouter(viewer, message);
    return { role: "assistant", text, mode: "preview", toolCalls, createdAt };
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-12).map((t): Anthropic.MessageParam => ({ role: t.role, content: t.text || "(empty)" })),
    { role: "user", content: message },
  ];
  const toolCalls: ToolCall[] = [];
  let text = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: config.model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: TOOL_DEFINITIONS,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new AssistantError("The Claude API key was rejected. Check ANTHROPIC_API_KEY.");
      if (err instanceof Anthropic.RateLimitError) throw new AssistantError("The Claude API is rate limiting requests. Try again in a moment.");
      if (err instanceof Anthropic.APIError) throw new AssistantError(`Claude API error ${err.status}: ${err.message}`);
      throw err;
    }

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text);
    if (textBlocks.length) text = textBlocks.join("\n");

    if (response.stop_reason === "refusal") {
      text = text || "The model declined to answer this request.";
      break;
    }
    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") break;
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) break;
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input ?? {}) as Record<string, unknown>;
      try {
        const result = executeTool(viewer, tu.name, input);
        toolCalls.push({ name: tu.name, input, result });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
      } catch (err) {
        const msg = err instanceof ToolError ? err.message : "Tool failed.";
        toolCalls.push({ name: tu.name, input, result: null, error: msg });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: msg, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return { role: "assistant", text: text || "I ran the tools but produced no explanation. The tool results are shown below.", mode: "claude", toolCalls, createdAt };
}

export class AssistantError extends Error {}
