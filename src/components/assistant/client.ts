import type { ActionView } from "@/lib/actions-engine";
import type { AssistantEnvelope, AssistantTurn, StreamEvent } from "@/lib/assistant/envelope-types";

export type { ActionView, AssistantEnvelope, AssistantTurn, StreamEvent };

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export const actionsApi = {
  draft: (type: string, payload: unknown, idempotencyKey?: string) => post<{ action: ActionView }>("/api/actions", { op: "draft", type, payload, idempotencyKey }).then((r) => r.action),
  get: (id: string) => post<{ action: ActionView }>("/api/actions", { op: "get", id }).then((r) => r.action),
  approve: (id: string, expectedVersion: number) => post<{ action: ActionView }>("/api/actions", { op: "approve", id, expectedVersion }).then((r) => r.action),
  apply: (id: string) => post<{ action: ActionView }>("/api/actions", { op: "apply", id }).then((r) => r.action),
  cancel: (id: string) => post<{ action: ActionView }>("/api/actions", { op: "cancel", id }).then((r) => r.action),
};

export function idempotencyKey(prefix: string): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${rand}`;
}

export const preferencesApi = {
  update: (prefs: { theme?: "system" | "light" | "dark"; spokenReplies?: boolean; sharePersonalSummary?: boolean }) => post<{ preferences: { theme: string; spokenReplies: boolean; sharePersonalSummary: boolean } }>("/api/preferences", prefs).then((r) => r.preferences),
};

/** Streams one assistant turn. Resolves with the final envelope, or throws on error / abort. */
export async function streamAssistant(message: string, scope: "me" | "company" | "household", onEvent: (e: StreamEvent) => void, signal: AbortSignal): Promise<AssistantEnvelope> {
  const res = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, scope, stream: true }), signal });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `The assistant failed (${res.status}).`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AssistantEnvelope | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as StreamEvent;
      onEvent(event);
      if (event.type === "final") final = event.envelope;
      if (event.type === "error") throw new Error(event.message);
    }
  }
  if (!final) throw new Error("The assistant returned no answer. Nothing was saved.");
  return final;
}
