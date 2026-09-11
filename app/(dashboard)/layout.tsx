import type { ReactNode } from "react";
import { Shell } from "@/components/shell/Shell";
import { getRuntime } from "@/lib/db/runtime";
import { getActor } from "@/lib/ui/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  let profile = { displayName: "Tau lab", isSynthetic: true, asOfDate: "—" };
  let badges = { approvals: 0, attention: 0 };
  try {
    const rt = await getRuntime();
    profile = { displayName: rt.dataset.profile.displayName, isSynthetic: rt.dataset.profile.isSynthetic, asOfDate: rt.asOfDate };
    const pending = rt.dataset.approvals.filter((a) => a.status === "PENDING").length;
    const unresolvedWorkers = rt.dataset.workers.filter((w) => w.classificationStatus !== "CONFIRMED").length;
    badges = { approvals: pending, attention: pending + unresolvedWorkers };
  } catch {
    // Runtime failed to initialise; the pages show their own notices.
  }
  return (
    <Shell actor={{ id: actor.id, role: actor.role, displayName: actor.displayName }} profile={profile} badges={badges}>
      {children}
    </Shell>
  );
}
