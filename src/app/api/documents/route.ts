import { NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/auth/authorize";
import { getViewer } from "@/lib/auth/session";
import { listDocuments, storeDocument } from "@/lib/documents";
import type { Document } from "@/lib/db/schema";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";

/** Strip server paths and raw text before anything leaves the API. */
function publicDoc(d: Document) {
  const { storagePath, textContent, ...safe } = d;
  void storagePath;
  void textContent;
  return safe;
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  return NextResponse.json({ documents: listDocuments(viewer).map((d) => publicDoc(d)) });
}

export async function POST(req: Request) {
  const { error } = safeConfig();
  if (error) return NextResponse.json({ error }, { status: 500 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const fd = await req.formData().catch(() => null);
  const file = fd?.get("file");
  const spaceId = String(fd?.get("spaceId") ?? "");
  if (!(file instanceof File) || !spaceId) return NextResponse.json({ error: "Choose a file and a space." }, { status: 400 });
  try {
    const doc = await storeDocument(viewer, spaceId, file, (String(fd?.get("kind") ?? "receipt") as "receipt" | "quote" | "statement" | "tax" | "other"));
    return NextResponse.json({ document: publicDoc(doc) });
  } catch (err) {
    if (err instanceof AuthorizationError) return NextResponse.json({ error: err.message }, { status: 403 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed." }, { status: 400 });
  }
}
