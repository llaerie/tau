import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/session";
import { loadSpaceData } from "@/lib/data/spaces";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";

/** JSON export of everything the signed-in viewer is allowed to see. Nothing more. */
export async function GET() {
  const { error } = safeConfig();
  if (error) return NextResponse.json({ error }, { status: 500 });
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const spaces = viewer.spaces.map((sp) => {
    const d = loadSpaceData(viewer, sp);
    return { space: sp, accounts: d.accounts, bills: d.bills, goals: d.goals, transactions: d.transactions };
  });
  const body = { exportedAt: new Date().toISOString(), workspace: { id: viewer.workspace.id, name: viewer.workspace.name, isDemo: viewer.isDemo }, assumptions: viewer.assumptions, spaces };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="finance-desk-export.json"` },
  });
}
