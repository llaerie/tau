import { NextResponse } from "next/server";
import { z } from "zod";
import type { AssistantTurn, StreamEvent } from "@/lib/assistant/envelope-types";
import { loadHistory } from "@/lib/assistant/history";
import { AssistantError, runAssistant } from "@/lib/assistant/run";
import { getViewer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import * as s from "@/lib/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const { config, error } = safeConfig();
  if (error || !config) return NextResponse.json({ error }, { status: 500 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({ history: loadHistory(viewer.workspace.id, viewer.user.id), connected: !!config.anthropicApiKey, model: config.model });
}

const bodySchema = z.object({ message: z.string().min(1).max(4000), scope: z.enum(["me", "company", "household"]).default("me"), stream: z.boolean().default(true) });

export async function POST(req: Request) {
  const { config, error } = safeConfig();
  if (error || !config) return NextResponse.json({ error }, { status: 500 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Enter a question." }, { status: 400 });
  const { message, scope } = body.data;
  const db = getDb();
  const history = loadHistory(viewer.workspace.id, viewer.user.id);
  const userTurn: AssistantTurn = { role: "user", text: message, createdAt: nowIso(), scope };
  const persist = (reply: AssistantTurn) => {
    db.insert(s.assistantMessages).values([
      { id: newId("msg"), workspaceId: viewer.workspace.id, userId: viewer.user.id, role: "user", json: JSON.stringify(userTurn), createdAt: userTurn.createdAt },
      { id: newId("msg"), workspaceId: viewer.workspace.id, userId: viewer.user.id, role: "assistant", json: JSON.stringify(reply), createdAt: reply.createdAt },
    ]).run();
  };

  if (!body.data.stream) {
    try {
      const reply = await runAssistant(viewer, history, message, scope, { signal: req.signal });
      persist(reply);
      return NextResponse.json({ turn: reply });
    } catch (err) {
      if (err instanceof AssistantError) return NextResponse.json({ error: err.message }, { status: 502 });
      console.error(err);
      return NextResponse.json({ error: "The assistant failed. Nothing was saved." }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const reply = await runAssistant(viewer, history, message, scope, { signal: req.signal, onEvent: send });
        persist(reply);
      } catch (err) {
        send({ type: "error", message: err instanceof AssistantError ? err.message : "The assistant failed. Nothing was saved." });
        if (!(err instanceof AssistantError)) console.error(err);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}

export async function DELETE() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  getDb().delete(s.assistantMessages).where(and(eq(s.assistantMessages.workspaceId, viewer.workspace.id), eq(s.assistantMessages.userId, viewer.user.id))).run();
  return NextResponse.json({ ok: true });
}
