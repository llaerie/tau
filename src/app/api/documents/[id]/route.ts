import { NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/auth/authorize";
import { getViewer } from "@/lib/auth/session";
import { readDocumentFile } from "@/lib/documents";

export const dynamic = "force-dynamic";

/** Serves a document only to viewers with a role on its space. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const { doc, bytes } = readDocumentFile(viewer, id);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": doc.mime, "content-disposition": `inline; filename="${doc.filename.replace(/"/g, "")}"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
