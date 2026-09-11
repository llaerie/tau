import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/session";
import { buildPartnerSummary } from "@/lib/views";

export const dynamic = "force-dynamic";

/** Pre-approved aggregate fields only, at month granularity. No filters are accepted. */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const partner = viewer.persons.find((p) => p.id !== viewer.person?.id);
  if (!partner) return NextResponse.json({ summary: null });
  return NextResponse.json({ summary: buildPartnerSummary(viewer, partner.id) });
}
