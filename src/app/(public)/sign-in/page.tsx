import { redirect } from "next/navigation";
import { ModeBadge } from "@/components/AppShell";
import { ConfigErrorScreen } from "@/components/ConfigErrorScreen";
import { DemoPersonaButtons, LiveAuthForms } from "@/components/forms/AuthForms";
import { getViewer } from "@/lib/auth/session";
import { safeConfig } from "@/lib/safe-config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { config, error } = safeConfig();
  if (error || !config) return <ConfigErrorScreen message={error ?? "Configuration error"} />;
  if (await getViewer()) redirect("/");
  const sp = await searchParams;
  const invite = typeof sp.invite === "string" ? sp.invite : "";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8">
        <p className="label">Finance Desk</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-ink-2">Company, household and two personal spaces. Kept separate, connected by classified transactions.</p>
        <ModeBadge isDemo={config.mode === "demo"} className="mt-3" />
      </div>
      {config.mode === "demo" ? (
        <div className="card p-5">
          <h2 className="font-medium">Choose a demo persona</h2>
          <p className="mt-1 text-sm text-ink-3">All figures are synthetic. Each person sees the company and household, plus only their own personal space.</p>
          <DemoPersonaButtons />
          <p className="mt-4 text-xs text-ink-3">Changes you make persist in the local demo database. Reset them any time from Settings.</p>
        </div>
      ) : (
        <LiveAuthForms inviteCode={invite} />
      )}
    </main>
  );
}
