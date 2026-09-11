import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { nowIso } from "@/lib/ids";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const schema = z.object({ theme: z.enum(["system", "light", "dark"]).optional(), spokenReplies: z.boolean().optional(), sharePersonalSummary: z.boolean().optional() });

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid preferences." }, { status: 400 });
  const db = getDb();
  const current = db.select().from(s.userPreferences).where(eq(s.userPreferences.userId, viewer.user.id)).get();
  const next = { theme: parsed.data.theme ?? current?.theme ?? "system", spokenReplies: parsed.data.spokenReplies ?? current?.spokenReplies ?? false, sharePersonalSummary: parsed.data.sharePersonalSummary ?? current?.sharePersonalSummary ?? true, updatedAt: nowIso() };
  db.insert(s.userPreferences).values({ userId: viewer.user.id, ...next }).onConflictDoUpdate({ target: s.userPreferences.userId, set: next }).run();
  const jar = await cookies();
  jar.set("fd_theme", next.theme, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return NextResponse.json({ preferences: next });
}

