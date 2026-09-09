import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AssistantError, runAssistant, type AssistantTurn } from "@/lib/assistant/run";
import { getViewer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { newId, nowIso } from "@/lib/ids";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";

function loadHistory(workspaceId: string, userId: string): AssistantTurn[] {
  return getDb()
    .select()
    .from(s.assistantMessages)
    .where(and(eq(s.assistantMessages.workspaceId, workspaceId), eq(s.assistantMessages.userId, userId)))
    .orderBy(asc(s.assistantMessages.createdAt))
    .all()
    .map((m) => JSON.parse(m.json) as AssistantTurn);
}

export async function GET() {
  const { config, error } = safeConfig();
  if (error || !config) return NextResponse.json({ error }, { status: 500 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({ history: loadHistory(viewer.workspace.id, viewer.user.id), connected: !!config.anthropicApiKey, model: config.model });
}

export async function POST(req: Request) {
  const { config, error } = safeConfig();
  if (error || !config) return NextResponse.json({ error }, { status: 500 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = z.object({ message: z.string().min(1).max(2000) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Enter a question." }, { status: 400 });

  const db = getDb();
  const history = loadHistory(viewer.workspace.id, viewer.user.id);
  const userTurn: AssistantTurn = { role: "user", text: body.data.message, createdAt: nowIso() };
  try {
    const reply = await runAssistant(viewer, history, body.data.message);
    db.insert(s.assistantMessages).values([
      { id: newId("msg"), workspaceId: viewer.workspace.id, userId: viewer.user.id, role: "user", json: JSON.stringify(userTurn), createdAt: userTurn.createdAt },
      { id: newId("msg"), workspaceId: viewer.workspace.id, userId: viewer.user.id, role: "assistant", json: JSON.stringify(reply), createdAt: reply.createdAt },
    ]).run();
    return NextResponse.json({ turn: reply });
  } catch (err) {
    if (err instanceof AssistantError) return NextResponse.json({ error: err.message }, { status: 502 });
    console.error(err);
    return NextResponse.json({ error: "The assistant failed. Nothing was saved." }, { status: 500 });
  }
}

export async function DELETE() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  getDb().delete(s.assistantMessages).where(and(eq(s.assistantMessages.workspaceId, viewer.workspace.id), eq(s.assistantMessages.userId, viewer.user.id))).run();
  return NextResponse.json({ ok: true });
}
