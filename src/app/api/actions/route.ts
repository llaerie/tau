import { NextResponse } from "next/server";
import { z } from "zod";
import { ActionEngineError, applyAction, approveAction, cancelAction, draftAction, getAction, listRecentActions, payloadSchemas } from "@/lib/actions-engine";
import { AuthorizationError } from "@/lib/auth/authorize";
import { getViewer } from "@/lib/auth/session";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("draft"), type: z.enum(Object.keys(payloadSchemas) as [string, ...string[]]), payload: z.unknown(), idempotencyKey: z.string().min(8).max(120).optional() }),
  z.object({ op: z.literal("approve"), id: z.string(), expectedVersion: z.number().int() }),
  z.object({ op: z.literal("apply"), id: z.string() }),
  z.object({ op: z.literal("cancel"), id: z.string() }),
  z.object({ op: z.literal("get"), id: z.string() }),
]);

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({ actions: listRecentActions(viewer) });
}

export async function POST(req: Request) {
  const { error } = safeConfig();
  if (error) return NextResponse.json({ error }, { status: 500 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  try {
    switch (b.op) {
      case "draft":
        return NextResponse.json({ action: draftAction(viewer, b.type as keyof typeof payloadSchemas, b.payload, b.idempotencyKey) });
      case "approve":
        return NextResponse.json({ action: approveAction(viewer, b.id, b.expectedVersion) });
      case "apply":
        return NextResponse.json({ action: applyAction(viewer, b.id) });
      case "cancel":
        return NextResponse.json({ action: cancelAction(viewer, b.id) });
      case "get":
        return NextResponse.json({ action: getAction(viewer, b.id) });
    }
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof ActionEngineError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "The action failed. Nothing was saved." }, { status: 500 });
  }
}
