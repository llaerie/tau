import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ConfigErrorScreen } from "@/components/ConfigErrorScreen";
import { getViewer } from "@/lib/auth/session";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { error } = safeConfig();
  if (error) return <ConfigErrorScreen message={error} />;
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in");
  return (
    <AppShell workspaceName={viewer.workspace.name} userName={viewer.person?.name ?? viewer.user.name} isDemo={viewer.isDemo}>
      {children}
    </AppShell>
  );
}
